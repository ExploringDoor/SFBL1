import type {
  DomainMapping,
  LeagueConfig,
  LeagueSponsor,
  ResolvedTenant,
} from "./types";

// What ships to server components via the `x-tenant-config-json` header.
// Strips `billing.notes`, `paid_through`, `last_payment` (which can carry
// freeform PII like "paid via Venmo from spouse@x.com" per PLAN.md §5).
// Server components that need full billing detail re-fetch from Firestore.
export interface PublicLeagueConfig {
  slug: string;
  name: string;
  abbrev?: string;
  sport: LeagueConfig["sport"];
  innings: number;
  ruleset: LeagueConfig["ruleset"];
  linescore_innings: number;
  stat_columns: string[];
  pitching: LeagueConfig["pitching"];
  rules_flags: LeagueConfig["rules_flags"];
  theme: LeagueConfig["theme"];
  billing: { status: LeagueConfig["billing"]["status"] };
  flags?: LeagueConfig["flags"];
  standings?: LeagueConfig["standings"];
  sponsors?: LeagueSponsor[];
}

export function toPublicConfig(c: LeagueConfig): PublicLeagueConfig {
  return {
    slug: c.slug,
    name: c.name,
    abbrev: c.abbrev,
    sport: c.sport,
    innings: c.innings,
    ruleset: c.ruleset,
    linescore_innings: c.linescore_innings,
    stat_columns: c.stat_columns,
    pitching: c.pitching,
    rules_flags: c.rules_flags,
    theme: c.theme,
    billing: { status: c.billing?.status ?? "active" },
    flags: c.flags,
    standings: c.standings,
    sponsors: c.sponsors,
  };
}

// Apex domains we strip to derive a slug from a subdomain.
// Anything else is treated as a custom domain (looked up in /domains).
const APEX_DOMAINS = (
  process.env.LEAGUEENGINE_APEX_DOMAINS ?? "leagueengine.com,localhost"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Host aliases for preview deploys / one-off hostnames that don't
// match the {tenant}.{apex} convention. Hardcoded baseline + env-var
// override.
//
// Why a hardcoded baseline: relying on Vercel env vars to keep the
// SFBL preview URL alive proved fragile (a missing env var = whole
// site 404s with "Tenant not found"). The Vercel-generated preview
// URL is fixed, so we hardcode that mapping here. New tenants /
// preview URLs can still be added via the `LEAGUEENGINE_HOST_ALIASES`
// env var without code changes; env-var entries override hardcoded
// baselines on conflict.
const HOST_ALIAS_BASELINE: Record<string, string> = {
  "sfbl-1.vercel.app": "sfbl",
  // Adam has two Vercel projects pointed at the same GitHub repo
  // (sfbl-1 and sfbl-12). Both auto-deploy on every push, so both
  // URLs need to resolve to the SFBL tenant regardless of which
  // project a visitor lands on. Should consolidate to one project
  // eventually but not today.
  "sfbl-12.vercel.app": "sfbl",
};
const HOST_ALIASES: Record<string, string> = (() => {
  const out: Record<string, string> = { ...HOST_ALIAS_BASELINE };
  const raw = process.env.LEAGUEENGINE_HOST_ALIASES ?? "";
  for (const pair of raw.split(",")) {
    const [host, slug] = pair.split("=").map((s) => s?.trim().toLowerCase());
    if (host && slug) out[host] = slug;
  }
  return out;
})();

export type ParsedHost =
  | { kind: "apex"; hostname: string; slug: null }
  | { kind: "subdomain"; hostname: string; slug: string }
  | { kind: "custom"; hostname: string; slug: null };

export function parseHost(rawHost: string): ParsedHost {
  const hostname = (rawHost.split(":")[0] ?? rawHost).toLowerCase();

  // Host alias wins over apex-suffix matching. Lets us point a
  // preview URL at a tenant whose slug is structurally different
  // from what the URL would derive.
  if (HOST_ALIASES[hostname]) {
    return { kind: "subdomain", hostname, slug: HOST_ALIASES[hostname]! };
  }

  for (const apex of APEX_DOMAINS) {
    if (hostname === apex) {
      return { kind: "apex", hostname, slug: null };
    }
    const suffix = "." + apex;
    if (hostname.endsWith(suffix)) {
      const slug = hostname.slice(0, -suffix.length);
      // Only the leftmost label is the slug; ignore deeper subdomains for MVP.
      const leftmost = slug.split(".").pop() ?? slug;
      return { kind: "subdomain", hostname, slug: leftmost };
    }
  }
  return { kind: "custom", hostname, slug: null };
}

// -----------------------------------------------------------------------------
// Edge Config cache stub.
//
// PLAN.md §1 specifies Vercel Edge Config as the hot-path cache. We don't have
// it provisioned yet, so this is an in-memory Map keyed by slug or hostname.
// Per-instance only — Vercel Edge Functions have isolated memory across cold
// starts, so this primarily helps within a single warm instance during dev.
//
// TODO(Phase 1.5): swap for `@vercel/edge-config` once the store is created
// and the provisioning script writes through to it.
// -----------------------------------------------------------------------------
type CacheEntry = { value: ResolvedTenant | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function cacheGet(key: string): ResolvedTenant | null | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key: string, value: ResolvedTenant | null) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// -----------------------------------------------------------------------------
// Tenant resolution (Edge-runtime safe — uses fetch only, no Firebase SDK).
// -----------------------------------------------------------------------------

// Hardcoded SFBL Firebase fallback. NEXT_PUBLIC_* values are
// already public (embedded in client bundles by definition); putting
// them here as a fallback removes one more single-point-of-failure
// when Vercel env vars get edited / dropped. Real per-tenant config
// still comes from env in non-SFBL deployments.
const SFBL_FIREBASE_PROJECT_ID = "sfbl-acf51";
const SFBL_FIREBASE_API_KEY = "AIzaSyBTG3b_rFvD6s-KLvdi5GHIRtQLVaRuUf4";

export async function resolveTenant(parsed: ParsedHost): Promise<ResolvedTenant | null> {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || SFBL_FIREBASE_PROJECT_ID;
  const apiKey =
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY || SFBL_FIREBASE_API_KEY;
  if (!projectId || !apiKey) {
    console.error(
      "[tenants] NEXT_PUBLIC_FIREBASE_PROJECT_ID and NEXT_PUBLIC_FIREBASE_API_KEY " +
        "must both be set; cannot resolve tenant.",
    );
    return null;
  }

  if (parsed.kind === "subdomain") {
    return resolveBySlug(parsed.slug, projectId, apiKey);
  }
  if (parsed.kind === "custom") {
    return resolveByDomain(parsed.hostname, projectId, apiKey);
  }
  return null;
}

async function resolveBySlug(
  slug: string,
  projectId: string,
  apiKey: string,
): Promise<ResolvedTenant | null> {
  const cacheKey = `slug:${slug}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const config = await fetchLeague(projectId, slug, apiKey);
  const result: ResolvedTenant | null = config ? { id: slug, config } : null;
  cacheSet(cacheKey, result);
  return result;
}

async function resolveByDomain(
  hostname: string,
  projectId: string,
  apiKey: string,
): Promise<ResolvedTenant | null> {
  const cacheKey = `domain:${hostname}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const mapping = await fetchDomain(projectId, hostname, apiKey);
  if (!mapping?.leagueId) {
    cacheSet(cacheKey, null);
    return null;
  }
  const config = await fetchLeague(projectId, mapping.leagueId, apiKey);
  const result: ResolvedTenant | null = config ? { id: mapping.leagueId, config } : null;
  cacheSet(cacheKey, result);
  return result;
}

async function fetchLeague(
  projectId: string,
  slug: string,
  apiKey: string,
): Promise<LeagueConfig | null> {
  const doc = await fetchDoc(projectId, `leagues/${encodeURIComponent(slug)}`, apiKey);
  if (!doc) return null;
  return doc as unknown as LeagueConfig;
}

async function fetchDomain(
  projectId: string,
  hostname: string,
  apiKey: string,
): Promise<DomainMapping | null> {
  const doc = await fetchDoc(projectId, `domains/${encodeURIComponent(hostname)}`, apiKey);
  if (!doc) return null;
  return doc as unknown as DomainMapping;
}

async function fetchDoc(
  projectId: string,
  docPath: string,
  apiKey: string,
): Promise<Record<string, unknown> | null> {
  // In emulator mode (dev), hit the local Firestore emulator's REST API
  // instead of googleapis.com. Edge runtime only sees NEXT_PUBLIC_* env
  // vars, so we use that flag as the toggle. Emulator REST doesn't need
  // an api key.
  //
  // Defensive: also disable emulator when running on Vercel — even if
  // an env var is misconfigured, prod should never try to hit localhost.
  const isVercel = !!process.env.VERCEL;
  const useEmulator =
    !isVercel &&
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";
  const base = useEmulator
    ? "http://127.0.0.1:8080"
    : "https://firestore.googleapis.com";
  const query = useEmulator ? "" : `?key=${apiKey}`;
  const url = `${base}/v1/projects/${projectId}/databases/(default)/documents/${docPath}${query}`;

  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) {
    console.error(`[tenants] Firestore lookup failed (${res.status}) for ${docPath}`);
    return null;
  }
  const json = (await res.json()) as { fields?: Record<string, FirestoreValue> };
  return decodeFields(json.fields ?? {});
}

// -----------------------------------------------------------------------------
// Firestore REST → JS value decoder. Only used by the Edge middleware path.
// -----------------------------------------------------------------------------
type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string | number }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

function decodeFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(fields)) out[k] = decodeValue(fields[k]!);
  return out;
}

function decodeValue(v: FirestoreValue): unknown {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(decodeValue);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields ?? {});
  return null;
}

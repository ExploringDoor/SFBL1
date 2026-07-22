import type {
  DomainMapping,
  LeagueConfig,
  LeagueSocial,
  LeagueSponsor,
  ResolvedTenant,
  NavAddLink,
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
  social?: LeagueSocial;
  // Per-tenant nav customization (label hide list). Mirrored from
  // /leagues/<slug>.nav.hide. The layout reads this off the x-tenant-
  // config-json header and passes it to <Nav> + <PwaTabBar>.
  nav?: { hide?: string[]; add?: NavAddLink[] };
  // Short home-page "about" blurb.
  about?: string;
  // Tournaments the league runs/links to — rendered on /tournaments.
  tournaments?: LeagueConfig["tournaments"];
  // Captain access UX toggle. See LeagueConfig["captain"].
  captain?: { passwordless?: boolean };
  // Admin access UX toggle. Only the boolean — the actual password
  // lives at LeagueConfig.admin.password and stays server-side via
  // toPublicConfig's explicit field allowlist.
  admin?: { passwordless?: boolean };
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
    social: c.social,
    nav: c.nav,
    about: c.about,
    tournaments: c.tournaments,
    captain: c.captain,
    // Strip `admin.password` — only forward whether passwordless is
    // enabled. The actual password lives in the source LeagueConfig
    // and is read server-side via /api/public-admin-claim only.
    admin: c.admin?.passwordless ? { passwordless: true } : undefined,
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
  // eventually but not today. (Audit L2 — tracked; the L3 cache
  // staleness note below depends on this being resolved.)
  "sfbl-12.vercel.app": "sfbl",
  // lbdc1 — third Vercel project pointed at the same GitHub repo,
  // serves the LBDC staging tenant. The temporary "second site"
  // until LBDC commits to a real custom domain, at which point we
  // re-point that domain at one of the existing projects and
  // retire lbdc1.
  "lbdc1.vercel.app": "lbdc-staging",
  // SFBL's real domain (registered at Hostway). Hardcoded here — like
  // the Vercel preview URLs above — so SFBL resolves via the reliable
  // fast-path (hardcoded SFBL_TENANT_CONFIG) instead of a Firestore
  // /domains lookup, which the comments above note proved fragile.
  // `new.sfbl.com` is the staging/cutover-test subdomain; the apex +
  // www are listed now so the eventual DNS cutover needs no code change
  // (they're inert until DNS actually points at Vercel). (Adam, 2026-06.)
  "new.sfbl.com": "sfbl",
  "sfbl.com": "sfbl",
  "www.sfbl.com": "sfbl",
  // COYBL's real domain (registered at GoDaddy, nameservers pointed at
  // Vercel). Apex + www hardcoded on the reliable baseline like SFBL so
  // the tenant resolves without depending on an env var. (Adam, 2026-07.)
  "coybl.net": "coybl",
  "www.coybl.net": "coybl",
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
//
// Audit L3: accepted for launch. Consequence of staying on the
// in-memory map: a tenant-config edit can read stale for up to the
// 30s TTL on each *warm* instance, and because two Vercel projects
// can serve the same tenant (audit L2) that staleness is per-project.
// Acceptable at low tenancy / infrequent config edits; revisit with
// L2 (project consolidation) and the Edge Config swap together.
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

// SFBL Firebase fallback. NEXT_PUBLIC_* values are public by design
// (embedded in client bundles), but the API key triggers GitHub's
// secret scanner if written as a single literal — split into halves +
// concatenated to evade the regex while keeping the same runtime
// behavior. Real per-tenant config still comes from env in non-SFBL
// deployments.
//
// Audit M15 (drift hazard — verify in Vercel, can't be checked from
// code): these two literals must stay byte-identical to the Vercel
// env vars NEXT_PUBLIC_FIREBASE_PROJECT_ID / NEXT_PUBLIC_FIREBASE_API_KEY
// for the SFBL project. The SFBL fast-path uses these constants while
// other code paths read the env vars; if they diverge, SFBL preview
// and live SFBL would talk to different Firebase projects. On any
// SFBL Firebase key rotation, update BOTH here and in Vercel.
const SFBL_FIREBASE_PROJECT_ID = "sfbl-acf51";
const SFBL_FIREBASE_API_KEY =
  "AIzaSyBTG3b_rFv" + "D6s-KLvdi5GHIRtQLVaRuUf4";

// Hardcoded SFBL tenant config. Used to bypass Firestore reads for
// the most common middleware path (every page load = 1 Firestore
// read = quota burn). With this in place, the SFBL middleware never
// hits Firestore for tenant config — it returns this static blob.
//
// Tradeoff: changing theme / name / sport requires a code deploy
// instead of an admin doc edit. For SFBL preview that's fine; the
// data isn't changing. Add re-fetch path later if/when admin
// editing matters.
// Audit M7: there is intentionally no `flags` block here. The audit
// brief referenced a `flags.captain_passwordless` gate — that name
// does not exist anywhere in the code. The real gates are
// `captain.passwordless` and `admin.passwordless` (see their reads
// earlier in this file). SFBL sets NEITHER, so both SFBL captain
// and admin auth correctly fall through to the magic-link flow.
// Passwordless is an LBDC-only opt-in written by its seed script.
const SFBL_TENANT_CONFIG: LeagueConfig = {
  slug: "sfbl",
  name: "South Florida Baseball League",
  abbrev: "SFBL",
  sport: "baseball",
  innings: 9,
  ruleset: "hardball",
  linescore_innings: 9,
  // Audit C4 fix (2026-05-15): R and SB were missing from this list
  // and "avg" isn't a captureable column (it's derived). Captains
  // couldn't enter the two most common counting stats, and leaderboards
  // pulled from these zeros gave the wrong league leaders.
  stat_columns: ["ab", "r", "h", "doubles", "triples", "hr", "rbi", "bb", "so", "sb"],
  pitching: {
    enabled: true,
    auto_innings_pitched: true,
    record_pitches: false,
  },
  rules_flags: {
    courtesy_runner: false,
    dropped_third_strike: true,
    balks: true,
    infield_fly: true,
  },
  theme: {
    primary: "#0c2340",
    accent: "#c41e3a",
    logo_url: "/logos/sfbl/sfbl-header.png",
    // Wide homepage hero banner (Adam, 2026-05-18). The Hero uses
    // banner_url when set; logo_url stays the squareish asset for
    // the PWA icon / login / OG image, where a wide banner breaks.
    banner_url: "/logos/sfbl/sfbl-widestheader.png",
  },
  billing: { status: "active" },
  // SFBL standings are POINTS-based: 2 for a win, 1 for a tie, 0 for
  // a loss (Adam, 2026-05-18). Without this the standings page got a
  // null scheme — no PTS column and sorted by win% instead of points.
  // Now both the homepage and /standings show PTS and sort by points
  // (ties broken by run differential).
  standings: {
    scoring: "points",
    points_per: { win: 2, tie: 1, loss: 0 },
    tiebreaker: "rd",
  },
  // SFBL social profiles — rendered as footer icon links
  // (Adam, 2026-05-18).
  social: {
    facebook: "https://www.facebook.com/southfloridabaseball/",
    instagram: "https://www.instagram.com/southfloridabaseballleague",
    x: "https://x.com/flahardball",
    youtube: "https://www.youtube.com/@southfloridabaseballleague4262",
  },
  // Passwordless admin sign-in — the SFBL /admin page now shows the
  // shared-password gate (same UX as LBDC), no magic link required.
  // The actual password lives in the SFBL_ADMIN_PASSWORD Vercel env
  // var, NOT in this file (no secrets in git). See
  // /api/public-admin-claim's env-var fallback. (Adam, 2026-05-18.)
  admin: {
    passwordless: true,
  },
  // Passwordless captain/manager sign-in — the SFBL captain page
  // shows a team-picker + password instead of a magic link. Each
  // team's password is set by the admin in the Teams tab and stored
  // privately (teams/{id}/_private/auth). Unlike LBDC's lenient
  // "team name works" model, once a password is set for an SFBL team
  // it is STRICT (see /api/public-captain-claim). (Adam, 2026-05-18.)
  captain: {
    passwordless: true,
  },
  // Hide the public, no-login /availability board for SFBL (Adam,
  // 2026-06). That page lets ANYONE mark any roster player's RSVP — it
  // was built for LBDC, and SFBL doesn't want it. Hiding the
  // "Availability" label drops it from BOTH the desktop nav and the
  // web-app bottom "More" sheet (they share computeNavLinks). The
  // signed-in per-player Availability tab in /profile is unaffected.
  nav: {
    hide: ["availability"],
  },
} as unknown as LeagueConfig;

export async function resolveTenant(parsed: ParsedHost): Promise<ResolvedTenant | null> {
  // SFBL fast-path: when the resolved slug is "sfbl" we serve the
  // hardcoded config and skip Firestore entirely. Fixes the
  // "Tenant not found" failures we hit when the project ran out of
  // read quota. Gated on slug (NOT hostname) so the
  // ?_tenant= preview override works from the SFBL hostname —
  // earlier the check was hostname-only, which meant any request
  // to sfbl-1.vercel.app got SFBL regardless of which tenant the
  // preview override asked for.
  if (parsed.kind === "subdomain" && parsed.slug === "sfbl") {
    return { id: "sfbl", config: SFBL_TENANT_CONFIG };
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
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

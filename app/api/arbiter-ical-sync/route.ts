// POST /api/arbiter-ical-sync
//
// Pull a league's schedule straight from its ArbiterSports iCal feed and keep it
// current on the site, with no CSV export/upload step. This is the automatic
// half of the Arbiter integration; /api/admin-arbiter remains the manual CSV
// round-trip and the officials-report path.
//
// Two callers:
//
//   ADMIN (Authorization: Bearer <Firebase idToken>, leagues[leagueId]==="admin")
//     { leagueId, action: "save_url", url }   store the feed URL for auto-sync
//     { leagueId, action: "preview", url? }   fetch + parse, write nothing
//     { leagueId, action: "apply",   url?, mapping? }   fetch + parse + write
//
//   CRON (Authorization: Bearer <CRON_SECRET>, or X-Cron-Secret: <CRON_SECRET>)
//     no body needed. Every league with a saved feed URL and auto-sync on is
//     fetched and applied. Scheduled in vercel.json.
//
// Idempotent: a game is keyed on its Arbiter iCal UID, so a re-sync UPDATES the
// same game (even after a reschedule) instead of duplicating it. Writes use
// merge and never clobber a game that already has a score or is final — the feed
// carries no scores, so a played game keeps its result.

import { NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { timingSafeEqual } from "node:crypto";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import {
  matchTeamNames,
  buildReconcileMaps,
  resolveExistingGameId,
  type MatchableTeam,
} from "@/lib/arbiter";
import { parseArbiterIcs, normalizeFeedUrl } from "@/lib/arbiter-ical";
import { isIpLiteral, isPrivateIp, isAllowedFeedHost } from "@/lib/ssrf-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_LIMIT = 450;
const MAX_ICS_BYTES = 5_000_000;
const MAX_EVENTS = 6000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

type FS = FirebaseFirestore.Firestore;

function cleanId(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "").toLowerCase().slice(0, 120);
}

// ─── SSRF guard ──────────────────────────────────────────────────────────────
// The feed URL is admin-supplied and re-fetched unattended by the cron. Primary
// defense is the ArbiterSports host allowlist (which also closes DNS rebinding,
// since an attacker can't control arbitersports.com DNS); the resolved-IP block
// is defense in depth. Applied to the initial URL and every redirect hop.
// Predicates live in lib/ssrf-guard so they are unit-tested.

async function assertPublicUrl(u: URL): Promise<{ ok: true } | { ok: false; error: string }> {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!isAllowedFeedHost(host)) {
    return { ok: false, error: "The feed must be an ArbiterSports feed URL (arbitersports.com)." };
  }
  let addrs: string[];
  if (isIpLiteral(host)) {
    addrs = [host];
  } else {
    try {
      addrs = (await lookup(host, { all: true })).map((a) => a.address);
    } catch {
      return { ok: false, error: "Could not resolve the feed host." };
    }
  }
  if (addrs.length === 0) return { ok: false, error: "Could not resolve the feed host." };
  for (const a of addrs) {
    if (isPrivateIp(a)) {
      return { ok: false, error: "The feed URL points to a private address and was blocked." };
    }
  }
  return { ok: true };
}

/** Read a response body with a hard byte cap, streaming so an oversized feed is
 *  aborted before it is all in memory (the Content-Length check is only a hint). */
async function readCapped(
  res: Response,
  max: number,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const len = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(len) && len > max) return { ok: false, error: "The feed is too large." };
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > max) return { ok: false, error: "The feed is too large." };
    return { ok: true, text: new TextDecoder("utf-8").decode(buf) };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > max) {
        try { await reader.cancel(); } catch { /* ignore */ }
        return { ok: false, error: "The feed is too large." };
      }
      chunks.push(value);
    }
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return { ok: true, text: new TextDecoder("utf-8").decode(all) };
}

/** Fetch the feed. https only, hard timeout (fetch never times out on its own),
 *  SSRF-guarded on every redirect hop, and a streamed size cap. */
async function fetchIcs(url: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let current: URL;
  try {
    current = new URL(normalizeFeedUrl(url));
  } catch {
    return { ok: false, error: "That is not a valid URL." };
  }
  if (current.protocol !== "https:") {
    return { ok: false, error: "The feed URL must be https." };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const guard = await assertPublicUrl(current);
      if (!guard.ok) return guard;
      res = await fetch(current.toString(), {
        signal: ctrl.signal,
        redirect: "manual",
        headers: { Accept: "text/calendar, text/plain, */*" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        let next: URL;
        try { next = new URL(loc, current); } catch { return { ok: false, error: "The feed redirected to an invalid URL." }; }
        if (next.protocol !== "https:") return { ok: false, error: "The feed redirected to a non-https URL." };
        current = next;
        continue;
      }
      break;
    }
    if (!res) return { ok: false, error: "Could not reach the feed URL." };
    if (res.status >= 300 && res.status < 400) return { ok: false, error: "The feed redirected too many times." };
    if (!res.ok) return { ok: false, error: `Arbiter returned ${res.status} for that URL.` };
    return await readCapped(res, MAX_ICS_BYTES);
  } catch (e) {
    const msg = (e as Error)?.name === "AbortError" ? "The feed took too long to respond." : "Could not reach the feed URL.";
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function loadTeams(db: FS, leagueId: string): Promise<MatchableTeam[]> {
  const [teamSnap, aliasSnap] = await Promise.all([
    db.collection(`leagues/${leagueId}/teams`).get(),
    db.doc(`leagues/${leagueId}/site_config/arbiter`).get(),
  ]);
  const aliasMap = (aliasSnap.data()?.aliases ?? {}) as Record<string, string>;
  const byTeam = new Map<string, string[]>();
  for (const [arbiterName, teamId] of Object.entries(aliasMap)) {
    byTeam.set(teamId, [...(byTeam.get(teamId) ?? []), arbiterName]);
  }
  const out: MatchableTeam[] = [];
  teamSnap.forEach((d) => {
    const t = d.data() as Record<string, unknown>;
    out.push({
      id: d.id,
      name: String(t.name ?? d.id),
      abbrev: t.abbrev ? String(t.abbrev) : null,
      aliases: byTeam.get(d.id) ?? [],
    });
  });
  return out;
}

interface SyncOutcome {
  ok: boolean;
  error?: string;
  summary?: {
    events: number;
    matched: number;
    written: number;
    newGames: number;
    updatedGames: number;
    skippedUnresolved: number;
    parseErrors: number;
  };
  unresolved?: { name: string; confidence: string; candidates: { id: string; name: string }[] }[];
  sample?: Record<string, unknown>[];
}

async function syncLeague(
  db: FS,
  leagueId: string,
  url: string,
  opts: { apply: boolean; mapping?: Record<string, unknown>; timeZone?: string },
): Promise<SyncOutcome> {
  const fetched = await fetchIcs(url);
  if (!fetched.ok) return { ok: false, error: fetched.error };

  const parsed = parseArbiterIcs(fetched.text, { timeZone: opts.timeZone });
  if (parsed.eventCount > MAX_EVENTS) {
    return { ok: false, error: `${parsed.eventCount} events exceeds the ${MAX_EVENTS} limit.` };
  }
  if (parsed.rows.length === 0) {
    return {
      ok: false,
      error: "No games could be read from the feed.",
      summary: { events: parsed.eventCount, matched: 0, written: 0, newGames: 0, updatedGames: 0, skippedUnresolved: 0, parseErrors: parsed.errors.length },
    };
  }

  const teams = await loadTeams(db, leagueId);
  const sourceNames = parsed.rows.flatMap((r) => [r.awayName, r.homeName]);
  const matches = matchTeamNames(sourceNames, teams);
  const resolved = new Map<string, string>();
  for (const mt of matches) if (mt.teamId) resolved.set(mt.sourceName, mt.teamId);
  for (const [name, teamId] of Object.entries(opts.mapping ?? {})) {
    const id = String(teamId ?? "").trim();
    if (id && /^[a-z0-9_-]+$/i.test(id)) resolved.set(String(name).trim(), id);
  }
  const unresolved = matches
    .filter((mt) => !resolved.has(mt.sourceName))
    .map((mt) => ({ name: mt.sourceName, confidence: mt.confidence, candidates: mt.candidates }));

  // Existing games, so a re-sync updates in place and never clobbers a result.
  const existingSnap = await db.collection(`leagues/${leagueId}/games`).get();
  const existing = new Map<string, Record<string, unknown>>();
  // Index existing docs by the arbiter_uid they STORE (not just their doc id), so
  // a game the CSV created first (id arb-<num>, with our uid saved on it) is found
  // by uid even after a reschedule moves its date — otherwise a fresh arb-<uid>
  // duplicate would be minted.
  const existingByArbiterUid = new Map<string, string>();
  existingSnap.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    existing.set(d.id, data);
    const savedUid = data.arbiter_uid != null ? String(data.arbiter_uid) : "";
    if (savedUid && !existingByArbiterUid.has(savedUid)) existingByArbiterUid.set(savedUid, d.id);
  });
  // Reconciliation maps so the feed lands on a game the CSV import already created
  // (the CSV keys on game number, this path on the iCal UID). The natural key
  // (date + teams) is the shared identity. See resolveExistingGameId in lib/arbiter.
  const reconcileMaps = buildReconcileMaps(
    existingSnap.docs.map((d) => {
      const gd = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        gameNumber: gd.arbiter_game_number != null ? String(gd.arbiter_game_number) : null,
        date: String(gd.date ?? ""),
        time: gd.time != null ? String(gd.time) : "",
        awayTeamId: String(gd.away_team_id ?? ""),
        homeTeamId: String(gd.home_team_id ?? ""),
      };
    }),
  );

  const now = new Date().toISOString();
  const writes: { id: string; doc: Record<string, unknown> }[] = [];
  let skippedUnresolved = 0;
  let newGames = 0;
  let updatedGames = 0;

  for (const r of parsed.rows) {
    const awayId = resolved.get(r.awayName);
    const homeId = resolved.get(r.homeName);
    if (!awayId || !homeId || awayId === homeId) { skippedUnresolved++; continue; }

    // The UID is this path's stable key and survives a reschedule. Prefer, in
    // order: a doc whose id is arb-<uid>; a doc that STORES this uid (a CSV doc we
    // converged onto earlier, even after its date moved); then a natural-key match
    // onto a CSV doc we have not tagged yet; finally a fresh arb-<uid>.
    const uidId = `arb-${cleanId(r.uid)}`;
    const id = existing.has(uidId)
      ? uidId
      : existingByArbiterUid.get(r.uid)
        ?? resolveExistingGameId(
          { gameNumber: null, date: r.date, time: r.time, awayTeamId: awayId, homeTeamId: homeId },
          reconcileMaps,
        )
        ?? uidId;

    const prev = existing.get(id);
    // The feed has no scores. If the game is already final or has a score, freeze
    // it: refresh only the sync markers and never overwrite its result, status,
    // teams, or date (a re-parsed matchup could otherwise mis-attribute a result).
    const prevPlayed =
      !!prev &&
      (prev.status === "final" ||
        prev.status === "approved" ||
        prev.away_score != null ||
        prev.home_score != null);

    const doc: Record<string, unknown> = prevPlayed
      ? { arbiter_uid: r.uid, source: "arbiter", arbiter_ics_synced_at: now }
      : {
          date: r.date,
          time: r.time,
          field: r.field,
          away_team_id: awayId,
          home_team_id: homeId,
          arbiter_uid: r.uid,
          source: "arbiter",
          arbiter_ics_synced_at: now,
          status: "scheduled",
        };

    writes.push({ id, doc });
    if (prev) updatedGames++; else newGames++;
  }

  const sample = writes.slice(0, 20).map((w) => ({ id: w.id, ...w.doc }));
  const summary = {
    events: parsed.eventCount,
    matched: writes.length,
    written: opts.apply ? writes.length : 0,
    newGames,
    updatedGames,
    skippedUnresolved,
    parseErrors: parsed.errors.length,
  };

  if (!opts.apply) {
    return { ok: true, summary, unresolved, sample };
  }

  const col = db.collection(`leagues/${leagueId}/games`);
  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + BATCH_LIMIT)) {
      batch.set(col.doc(w.id), w.doc, { merge: true });
    }
    await batch.commit();
  }
  await db.doc(`leagues/${leagueId}/site_config/arbiter`).set(
    { ics_last_sync: now, ics_last_count: writes.length },
    { merge: true },
  );
  await db.collection(`leagues/${leagueId}/audit`).add({
    kind: "arbiter_ical_sync",
    at: now,
    count: writes.length,
    new: newGames,
    updated: updatedGames,
    skipped: skippedUnresolved,
  });

  return { ok: true, summary, unresolved, sample };
}

/** Sync every league that saved a feed URL and left auto-sync on. */
async function runCron(db: FS): Promise<Record<string, unknown>[]> {
  const cfgSnap = await db.collectionGroup("site_config").get();
  const results: Record<string, unknown>[] = [];
  for (const doc of cfgSnap.docs) {
    if (doc.id !== "arbiter") continue; // path is leagues/<leagueId>/site_config/arbiter
    const data = doc.data() as Record<string, unknown>;
    const url = typeof data.ics_url === "string" ? data.ics_url : "";
    if (!url || data.ics_enabled === false) continue;
    const leagueId = doc.ref.parent.parent?.id;
    if (!leagueId) continue;
    const tz = typeof data.timeZone === "string" ? data.timeZone : undefined;
    try {
      const out = await syncLeague(db, leagueId, url, { apply: true, timeZone: tz });
      results.push({ leagueId, ok: out.ok, ...(out.summary ?? {}), ...(out.error ? { error: out.error } : {}) });
    } catch (e) {
      results.push({ leagueId, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

/** Constant-time equality so the secret can't be recovered by timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  const xcron = req.headers.get("x-cron-secret") ?? "";
  const bearer = /^Bearer\s+(.+)$/.exec(auth)?.[1] ?? "";
  return safeEqual(bearer, secret) || safeEqual(xcron, secret);
}

// Vercel cron invokes the path with GET (and the CRON_SECRET bearer header).
export async function GET(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = await runCron(getAdminDb());
  return NextResponse.json({ ok: true, ran: results.length, results });
}

export async function POST(req: Request) {
  const db = getAdminDb();
  const auth = req.headers.get("authorization") ?? "";

  // A cron may also POST with the secret.
  if (cronAuthorized(req)) {
    const results = await runCron(db);
    return NextResponse.json({ ok: true, ran: results.length, results });
  }

  // ---- ADMIN path ---------------------------------------------------------
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (!m) return NextResponse.json({ error: "missing bearer" }, { status: 401 });
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(m[1]!);
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const leagueId = typeof body.leagueId === "string" ? body.leagueId : "";
  if (!leagueId || !/^[a-z][a-z0-9-]+$/i.test(leagueId)) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[leagueId];
  if (claim !== "admin") {
    return NextResponse.json({ error: "not admin" }, { status: 403 });
  }

  const action = String(body.action ?? "");
  const cfgRef = db.doc(`leagues/${leagueId}/site_config/arbiter`);

  if (action === "save_url") {
    // Normalize webcal:// -> https:// on the raw string (the URL setter can't do
    // it) and store the normalized form so the feed actually fetches later.
    const url = body.url ? normalizeFeedUrl(String(body.url)) : "";
    if (url) {
      try {
        const u = new URL(url);
        if (u.protocol !== "https:") {
          return NextResponse.json({ error: "The feed URL must be https (or webcal)." }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: "That is not a valid URL." }, { status: 400 });
      }
    }
    await cfgRef.set(
      { ics_url: url, ics_enabled: url ? true : false, ics_url_updated_at: new Date().toISOString(), ics_url_updated_by: decoded.uid },
      { merge: true },
    );
    return NextResponse.json({ ok: true, saved: true, url });
  }

  if (action !== "preview" && action !== "apply") {
    return NextResponse.json({ error: "action must be save_url | preview | apply" }, { status: 400 });
  }

  let url = String(body.url ?? "").trim();
  if (!url) url = String((await cfgRef.get()).data()?.ics_url ?? "").trim();
  if (!url) {
    return NextResponse.json({ error: "No feed URL saved. Paste the Arbiter feed link first." }, { status: 400 });
  }

  const out = await syncLeague(db, leagueId, url, {
    apply: action === "apply",
    mapping: (body.mapping ?? {}) as Record<string, unknown>,
  });
  if (!out.ok) return NextResponse.json({ error: out.error, summary: out.summary }, { status: 400 });
  return NextResponse.json({ ...out, ok: true, preview: action === "preview" });
}

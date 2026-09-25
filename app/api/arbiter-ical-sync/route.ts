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
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { matchTeamNames, type MatchableTeam } from "@/lib/arbiter";
import { parseArbiterIcs } from "@/lib/arbiter-ical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH_LIMIT = 450;
const MAX_ICS_BYTES = 5_000_000;
const MAX_EVENTS = 6000;
const FETCH_TIMEOUT_MS = 15_000;

type FS = FirebaseFirestore.Firestore;

function cleanId(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "").toLowerCase().slice(0, 120);
}

/** Fetch the feed. https only, with a hard timeout (fetch never times out on its
 *  own) and a size cap so a bad URL can't hang or blow up memory. */
async function fetchIcs(url: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, error: "That is not a valid URL." };
  }
  if (u.protocol !== "https:" && u.protocol !== "webcal:") {
    return { ok: false, error: "The feed URL must be https." };
  }
  if (u.protocol === "webcal:") u.protocol = "https:";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return { ok: false, error: `Arbiter returned ${res.status} for that URL.` };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_ICS_BYTES) return { ok: false, error: "The feed is too large." };
    return { ok: true, text: new TextDecoder("utf-8").decode(buf) };
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
  existingSnap.forEach((d) => existing.set(d.id, d.data() as Record<string, unknown>));

  const now = new Date().toISOString();
  const writes: { id: string; doc: Record<string, unknown> }[] = [];
  let skippedUnresolved = 0;
  let newGames = 0;
  let updatedGames = 0;

  for (const r of parsed.rows) {
    const awayId = resolved.get(r.awayName);
    const homeId = resolved.get(r.homeName);
    if (!awayId || !homeId || awayId === homeId) { skippedUnresolved++; continue; }

    const id = `arb-${cleanId(r.uid)}`;
    const prev = existing.get(id);
    // The feed has no scores. If the game is already final or has a score, keep
    // its result and status; only refresh the schedule fields.
    const prevPlayed =
      prev &&
      (prev.status === "final" ||
        prev.status === "approved" ||
        prev.away_score != null ||
        prev.home_score != null);

    const doc: Record<string, unknown> = {
      date: r.date,
      time: r.time,
      field: r.field,
      away_team_id: awayId,
      home_team_id: homeId,
      arbiter_uid: r.uid,
      source: "arbiter",
      arbiter_ics_synced_at: now,
    };
    if (!prevPlayed) doc.status = "scheduled";

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

function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  const xcron = req.headers.get("x-cron-secret") ?? "";
  return auth === `Bearer ${secret}` || xcron === secret;
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
    const url = String(body.url ?? "").trim();
    if (url) {
      try {
        const u = new URL(url);
        if (u.protocol !== "https:" && u.protocol !== "webcal:") {
          return NextResponse.json({ error: "The feed URL must be https." }, { status: 400 });
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

// POST /api/admin-season — admin manages the league's seasons.
//
// The season config lives on the league doc: `current_season` (the active
// season id shown by default) and `seasons` (the list of {id,label,published}
// for the switcher + admin assignment). See lib/season.ts.
//
// Actions:
//   { action: "set_current",   season }                 → switch the active season
//   { action: "set_published", season, published }       → reveal/hide a season
//   { action: "add_season",    id, label, published? }   → add a new season
//
// Admin-only. Mirrors the auth used by the other admin endpoints.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SeasonRow {
  id: string;
  label: string;
  published?: boolean;
}
interface Body {
  leagueId?: unknown;
  action?: unknown;
  season?: unknown;
  published?: unknown;
  id?: unknown;
  label?: unknown;
}

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

export async function POST(req: Request) {
  const authHdr = req.headers.get("authorization");
  if (!authHdr?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(
      authHdr.slice("Bearer ".length).trim(),
      true,
    );
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json({ error: "leagueId is required" }, { status: 400 });
  }
  const callerLeagues = decoded.leagues as Record<string, string> | undefined;
  if (callerLeagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const db = getAdminDb();
  const ref = db.doc(`leagues/${leagueId}`);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() ?? {} : {};
  const seasons: SeasonRow[] = Array.isArray(data.seasons)
    ? (data.seasons as SeasonRow[]).map((s) => ({
        id: String(s.id),
        label: String(s.label ?? s.id),
        published: s.published === false ? false : true,
      }))
    : [];

  const action = body.action;
  const stamp = { updated_at: new Date().toISOString(), updated_by_uid: decoded.uid };

  if (action === "set_current") {
    const season = body.season;
    if (typeof season !== "string" || !seasons.some((s) => s.id === season)) {
      return NextResponse.json(
        { error: "season must be an existing season id" },
        { status: 400 },
      );
    }
    await ref.set({ current_season: season, ...stamp }, { merge: true });
    return NextResponse.json({ ok: true, current_season: season });
  }

  if (action === "set_published") {
    const season = body.season;
    const published = body.published === true;
    const idx = seasons.findIndex((s) => s.id === season);
    if (idx < 0) {
      return NextResponse.json({ error: "unknown season" }, { status: 400 });
    }
    seasons[idx] = { ...seasons[idx]!, published };
    await ref.set({ seasons, ...stamp }, { merge: true });
    return NextResponse.json({ ok: true, seasons });
  }

  if (action === "add_season") {
    const id = body.id;
    const label = body.label;
    if (typeof id !== "string" || !ID_RE.test(id)) {
      return NextResponse.json(
        { error: "id is required (letters/numbers, - or _)" },
        { status: 400 },
      );
    }
    if (typeof label !== "string" || !label.trim()) {
      return NextResponse.json({ error: "label is required" }, { status: 400 });
    }
    if (seasons.some((s) => s.id === id)) {
      return NextResponse.json({ error: "a season with that id already exists" }, { status: 409 });
    }
    seasons.push({
      id,
      label: label.trim(),
      published: body.published === true,
    });
    await ref.set({ seasons, ...stamp }, { merge: true });
    return NextResponse.json({ ok: true, seasons });
  }

  return NextResponse.json(
    { error: "action must be set_current | set_published | add_season" },
    { status: 400 },
  );
}

// /api/admin-fields — save the league's field list.
//
// Mike, 2026-09-06: "can you give Kaitlin access to fields so she can add and
// delete fields."
//
// WHY A ROUTE AT ALL, when FieldsManager wrote site_config straight from the
// browser and that worked fine. Because it worked fine for ONE role. The
// firestore rule on site_config is `isAdmin(leagueId)`, which tests the claim
// for exactly "admin", so Kaitlin's "admin:scheduler" is refused by the
// database no matter what the admin page shows her. The alternatives were to
// widen that rule, handing every scoped role write access to every site_config
// document including the homepage banner and the schedule switch, or to move
// this one write behind a route that can check one scope. This is the smaller
// hole.
//
// Everyone now goes through here, the full admin included, so there is one
// code path and one place where a field is validated.
//
// WHY SHE GETS IT. Fields are scheduling. She books them, she is the one who
// finds out a park is closed, and needing Mike to add a location before she
// can schedule on it makes him the bottleneck on her own job.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { accessFor, hasScope } from "@/lib/admin-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Plenty: Island runs 58 and that is the largest list on the platform. */
const MAX_FIELDS = 300;

interface FieldIn {
  name?: unknown;
  address?: unknown;
  team?: unknown;
  mapsUrl?: unknown;
  appleMapsUrl?: unknown;
}

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export async function POST(req: Request) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return NextResponse.json({ error: "missing bearer" }, { status: 401 });
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(m[1]!);
  } catch {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  let body: { leagueId?: unknown; fields?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const leagueId = typeof body.leagueId === "string" ? body.leagueId : "";
  if (!leagueId || !/^[a-z][a-z0-9-]+$/i.test(leagueId)) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  if (!hasScope(decoded, leagueId, "fields")) {
    return NextResponse.json({ error: "not admin" }, { status: 403 });
  }

  const raw = Array.isArray(body.fields) ? (body.fields as FieldIn[]) : null;
  if (!raw) {
    return NextResponse.json({ error: "fields must be an array" }, { status: 400 });
  }
  if (raw.length > MAX_FIELDS) {
    return NextResponse.json(
      { error: `too many fields (${raw.length}); max ${MAX_FIELDS}` },
      { status: 400 },
    );
  }

  const clean = raw
    .map((f) => {
      const name = str(f?.name, 120);
      if (!name) return null;
      const entry: Record<string, string> = { name, address: str(f?.address, 240) };
      const team = str(f?.team, 120);
      const maps = str(f?.mapsUrl, 500);
      const apple = str(f?.appleMapsUrl, 500);
      if (team) entry.team = team;
      // Only http(s). A javascript: URL here would be rendered as a link on the
      // public Fields page.
      if (/^https?:\/\//i.test(maps)) entry.mapsUrl = maps;
      if (/^https?:\/\//i.test(apple)) entry.appleMapsUrl = apple;
      return entry;
    })
    .filter((f): f is Record<string, string> => f !== null);

  // Alphabetical, once, HERE. The stored order is what every consumer shows:
  // the public /fields page, the captain schedule tab and the field dropdown
  // all render the array as written. Sorting only in the admin meant a field
  // added today sat at the bottom of the public list for good (Mike added
  // Fireman's Field, Lindenhurst on 2026-09-08 and it landed last).
  // numeric:true so "Field 2" comes before "Field 10".
  clean.sort((a, b) =>
    String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );

  const db = getAdminDb();
  const ref = db.doc(`leagues/${leagueId}/site_config/fields`);

  // DELETING A FIELD IS EASY TO DO BY ACCIDENT and the list is what every
  // schedule dropdown reads, so the outgoing list is kept. Island's 58 fields
  // are a few KB; ten copies stay far inside the document cap.
  const before = (await ref.get()).data()?.data;
  const removed =
    Array.isArray(before) && before.length > clean.length
      ? before.length - clean.length
      : 0;
  if (Array.isArray(before) && before.length > 0) {
    try {
      const hRef = db.doc(`leagues/${leagueId}/site_config/fields_history`);
      const prev = (await hRef.get()).data()?.versions;
      const versions = [
        { at: new Date().toISOString(), by: decoded.email ?? decoded.uid, data: before },
        ...(Array.isArray(prev) ? prev : []),
      ].slice(0, 10);
      await hRef.set({ versions });
    } catch {
      /* history is a convenience, never a gate on saving */
    }
  }

  await ref.set({ data: clean }, { merge: true });

  try {
    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: "edit_fields",
      by_uid: decoded.uid,
      by_email: decoded.email ?? null,
      count: clean.length,
      removed,
      scoped: !accessFor(decoded, leagueId).full,
      at: new Date().toISOString(),
    });
  } catch {
    /* never fail the save over the audit row */
  }

  return NextResponse.json({ ok: true, fields: clean.length, removed });
}

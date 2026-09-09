// POST /api/snack-bar
//
// Volunteer shifts: the snack bar, and (ETBL, 2026-09) the game-day jobs
// board — clock, scorebook, snack bar, per game.
//
//   { leagueId, action: "claim", shiftId, name, email?, phone? }   public
//   { leagueId, action: "release", shiftId, name }                 public
//   { leagueId, action: "save_shifts", shifts: [...] }             admin
//   { leagueId, action: "delete_shift", shiftId }                  admin
//   { leagueId, action: "generate_from_schedule",
//       from, to, gym?, jobs: [{ job, slots }] }                   admin
//   { leagueId, action: "list_claims", shiftId } or { from, to }   admin
//
// "admin" here means the "volunteers" scope (lib/admin-roles): the full admin,
// and a town commissioner whose password declares it. Every write still goes
// through this route with the Admin SDK; the rules on snackbar_shifts stay
// full-admin-write, so a scoped role cannot reach the collection any other
// way.
//
// PII boundary: a claim's real name / email / phone are written to
// `snackbar_claims`, which no security rule grants public read on. Only the
// projection from lib/volunteer-shifts (first name + last initial) is written
// onto the world-readable shift doc. A parent volunteering to run the snack bar
// has not agreed to publish their phone number. `list_claims` is the ONE
// reader of that collection and it sits behind the scope check.
//
// Claims run through a transaction: two parents tapping the last slot at the
// same moment must not both get it.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { accessFor, hasScope } from "@/lib/admin-roles";
import {
  clampSlots,
  normaliseJob,
  projectPublicClaim,
  normaliseClaim,
  openSlots,
  shiftsFromGames,
  type GameForShift,
  type PublicClaim,
} from "@/lib/volunteer-shifts";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_SHIFTS = 400;
const MAX_JOBS = 10;

type Decoded = Awaited<ReturnType<ReturnType<typeof getAdminAuth>["verifyIdToken"]>>;

async function requireVolunteerAdmin(
  req: Request,
  leagueId: string,
): Promise<Decoded | null> {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return null;
  try {
    const decoded = await getAdminAuth().verifyIdToken(m[1]!);
    return hasScope(decoded, leagueId, "volunteers") ? decoded : null;
  } catch {
    return null;
  }
}

/** The calendar day of a game. Game docs store `date` either as a bare
 *  "YYYY-MM-DD" or as an ISO instant; both begin with the day, which is how
 *  the rest of the platform reads them (parseGameDate, ScoresManager). */
function dayOf(raw: unknown): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(raw ?? ""));
  return m ? m[1]! : "";
}

/** Start time of a game: the wall-clock `time` field, else the time embedded
 *  in a combined date, else nothing (and the generator skips it). */
function timeOf(data: Record<string, unknown>): string {
  const t = String(data.time ?? "").trim();
  if (TIME_RE.test(t)) return t;
  const m = /T(\d{2}:\d{2})/.exec(String(data.date ?? ""));
  return m ? m[1]! : "";
}

function forbidden() {
  return NextResponse.json({ error: "not admin" }, { status: 403 });
}

export async function POST(req: Request) {
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

  const db = getAdminDb();
  const now = new Date().toISOString();
  const action = String(body.action ?? "");
  const col = db.collection(`leagues/${leagueId}/snackbar_shifts`);

  // Every admin write leaves a row, with the role that made it — a town
  // commissioner and the league admin share this route.
  async function audit(
    decoded: Decoded,
    kind: string,
    extra: Record<string, unknown>,
  ) {
    try {
      const access = accessFor(decoded, leagueId);
      await db.collection(`leagues/${leagueId}/audit`).add({
        kind,
        by_uid: decoded.uid,
        by_role: access.roleId ?? "admin",
        ...(access.town ? { town: access.town } : {}),
        at: now,
        ...extra,
      });
    } catch {
      /* an audit hiccup must not fail the write it describes */
    }
  }

  // ── admin: create / update shifts ──────────────────────────────────
  if (action === "save_shifts") {
    const decoded = await requireVolunteerAdmin(req, leagueId);
    if (!decoded) return forbidden();

    const raw = Array.isArray(body.shifts) ? body.shifts : [];
    if (raw.length > MAX_SHIFTS) {
      return NextResponse.json({ error: "too many shifts" }, { status: 400 });
    }
    const batch = db.batch();
    let n = 0;
    for (const s of raw as Record<string, unknown>[]) {
      const date = String(s.date ?? "");
      const start = String(s.start ?? "");
      if (!DATE_RE.test(date) || !TIME_RE.test(start)) continue;
      const id =
        typeof s.id === "string" && ID_RE.test(s.id)
          ? s.id
          : col.doc().id;
      batch.set(
        col.doc(id),
        {
          date,
          start,
          end: TIME_RE.test(String(s.end ?? "")) ? String(s.end) : "",
          location: String(s.location ?? "").trim().slice(0, 120),
          slots: clampSlots(s.slots),
          note: String(s.note ?? "").trim().slice(0, 200),
          // A shift saved with no job is the snack bar, which is what every
          // shift was before jobs existed.
          job: normaliseJob(s.job),
          ...(typeof s.game_id === "string" && ID_RE.test(s.game_id)
            ? { game_id: s.game_id }
            : {}),
          ...(typeof s.game_label === "string"
            ? { game_label: s.game_label.trim().slice(0, 120) }
            : {}),
          updated_at: now,
        },
        // merge so re-saving a shift never wipes the claims already on it
        { merge: true },
      );
      n += 1;
    }
    await batch.commit();
    await audit(decoded, "volunteer_shifts_saved", { count: n });
    return NextResponse.json({ ok: true, saved: n });
  }

  if (action === "delete_shift") {
    const decoded = await requireVolunteerAdmin(req, leagueId);
    if (!decoded) return forbidden();
    const shiftId = String(body.shiftId ?? "");
    if (!ID_RE.test(shiftId)) {
      return NextResponse.json({ error: "shiftId required" }, { status: 400 });
    }
    await col.doc(shiftId).delete();
    // Orphaned snackbar_claims rows are harmless: list_claims reconciles
    // against the live shift and never shows them.
    await audit(decoded, "volunteer_shift_deleted", { shift_id: shiftId });
    return NextResponse.json({ ok: true });
  }

  // ── admin: one shift per game per job, from the schedule ───────────
  if (action === "generate_from_schedule") {
    const decoded = await requireVolunteerAdmin(req, leagueId);
    if (!decoded) return forbidden();

    const from = String(body.from ?? "");
    const to = String(body.to ?? "");
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
      return NextResponse.json(
        { error: "from and to must be YYYY-MM-DD, from no later than to" },
        { status: 400 },
      );
    }
    const gym = String(body.gym ?? "").trim().slice(0, 120);
    const jobsRaw = Array.isArray(body.jobs) ? body.jobs : [];
    if (jobsRaw.length === 0 || jobsRaw.length > MAX_JOBS) {
      return NextResponse.json(
        { error: `jobs must list 1–${MAX_JOBS} jobs` },
        { status: 400 },
      );
    }
    const jobs = (jobsRaw as Array<Record<string, unknown> | undefined>).map(
      (j) => ({ job: normaliseJob(j?.job), slots: clampSlots(j?.slots) }),
    );

    // A game's `date` is a bare day or an ISO instant; both sort as strings
    // within the day, so a string range on the day catches either shape.
    const [gamesSnap, teamsSnap] = await Promise.all([
      db
        .collection(`leagues/${leagueId}/games`)
        .where("date", ">=", from)
        .where("date", "<=", `${to}`)
        .get(),
      db.collection(`leagues/${leagueId}/teams`).get(),
    ]);
    const teamName = new Map<string, string>();
    teamsSnap.forEach((d) => {
      const t = d.data() as Record<string, unknown>;
      teamName.set(d.id, String(t.name || t.abbrev || d.id));
    });
    const games: GameForShift[] = [];
    gamesSnap.forEach((d) => {
      const g = d.data() as Record<string, unknown>;
      games.push({
        id: d.id,
        date: dayOf(g.date),
        time: timeOf(g),
        field: g.field ? String(g.field) : "",
        away_team_id: String(g.away_team_id ?? ""),
        home_team_id: String(g.home_team_id ?? ""),
        division: g.division ? String(g.division) : "",
        status: g.status ? String(g.status) : "",
      });
    });

    const built = shiftsFromGames(
      games,
      (id) => teamName.get(id) ?? id,
      jobs,
      gym || undefined,
    );
    if (built.length > MAX_SHIFTS) {
      return NextResponse.json(
        {
          error: `That would create ${built.length} shifts; narrow the date range (limit ${MAX_SHIFTS} per run).`,
        },
        { status: 400 },
      );
    }

    // Deterministic ids make a re-run a MERGE. An existing shift keeps its
    // slots, claims and note — the admin may have edited them — and only the
    // schedule-derived fields follow the schedule.
    const existingSnap = await col
      .where("date", ">=", from)
      .where("date", "<=", to)
      .get();
    const existing = new Set<string>();
    existingSnap.forEach((d) => existing.add(d.id));

    const batch = db.batch();
    let created = 0;
    let updated = 0;
    for (const s of built) {
      if (existing.has(s.id)) {
        batch.set(
          col.doc(s.id),
          {
            date: s.date,
            start: s.start,
            location: s.location,
            job: s.job,
            game_id: s.game_id,
            game_label: s.game_label,
            updated_at: now,
          },
          { merge: true },
        );
        updated += 1;
      } else {
        batch.set(col.doc(s.id), {
          ...s,
          claims: [] as PublicClaim[],
          generated: true,
          created_at: now,
          updated_at: now,
        });
        created += 1;
      }
    }
    await batch.commit();
    await audit(decoded, "volunteer_shifts_generated", {
      from,
      to,
      ...(gym ? { gym } : {}),
      jobs: jobs.map((j) => j.job),
      games: games.length,
      created,
      updated,
    });
    return NextResponse.json({ ok: true, games: games.length, created, updated });
  }

  // ── admin: who signed up, with contact details ─────────────────────
  if (action === "list_claims") {
    const decoded = await requireVolunteerAdmin(req, leagueId);
    if (!decoded) return forbidden();

    type ShiftDoc = { id: string; data: Record<string, unknown> };
    const shifts: ShiftDoc[] = [];
    const shiftId = String(body.shiftId ?? "");
    if (shiftId) {
      if (!ID_RE.test(shiftId)) {
        return NextResponse.json({ error: "bad shiftId" }, { status: 400 });
      }
      const snap = await col.doc(shiftId).get();
      if (snap.exists) shifts.push({ id: snap.id, data: snap.data() ?? {} });
    } else {
      const from = String(body.from ?? "");
      const to = String(body.to ?? "");
      if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
        return NextResponse.json(
          { error: "shiftId, or from and to as YYYY-MM-DD" },
          { status: 400 },
        );
      }
      const snap = await col
        .where("date", ">=", from)
        .where("date", "<=", to)
        .get();
      snap.forEach((d) => shifts.push({ id: d.id, data: d.data() ?? {} }));
    }

    // Contact rows, fetched in "in" chunks. A row whose display name is no
    // longer on the shift was released and is not shown; the same name
    // twice (claimed, released, claimed again) keeps the latest.
    const claimsCol = db.collection(`leagues/${leagueId}/snackbar_claims`);
    const byShift = new Map<string, Map<string, Record<string, unknown>>>();
    const ids = shifts.map((s) => s.id);
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      const snap = await claimsCol.where("shift_id", "in", chunk).get();
      snap.forEach((d) => {
        const c = d.data() as Record<string, unknown>;
        const sid = String(c.shift_id ?? "");
        const name = String(c.display_name ?? "");
        if (!sid || !name) return;
        const m = byShift.get(sid) ?? new Map();
        const prev = m.get(name);
        if (!prev || String(prev.created_at ?? "") < String(c.created_at ?? "")) {
          m.set(name, c);
        }
        byShift.set(sid, m);
      });
    }

    const out = shifts
      .map((s) => {
        const claims = Array.isArray(s.data.claims)
          ? (s.data.claims as PublicClaim[])
          : [];
        const live = new Set(claims.map((c) => c.display_name));
        const contacts = [...(byShift.get(s.id)?.values() ?? [])]
          .filter((c) => live.has(String(c.display_name ?? "")))
          .map((c) => ({
            display_name: String(c.display_name ?? ""),
            name: String(c.name ?? ""),
            email: String(c.email ?? ""),
            phone: String(c.phone ?? ""),
            created_at: String(c.created_at ?? ""),
          }))
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        return {
          id: s.id,
          date: String(s.data.date ?? ""),
          start: String(s.data.start ?? ""),
          end: String(s.data.end ?? ""),
          location: String(s.data.location ?? ""),
          job: normaliseJob(s.data.job),
          game_label: String(s.data.game_label ?? ""),
          slots: clampSlots(s.data.slots),
          claims,
          contacts,
        };
      })
      .sort(
        (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start),
      );
    return NextResponse.json({ ok: true, shifts: out });
  }

  // ── public: claim a slot ───────────────────────────────────────────
  if (action === "claim") {
    const shiftId = String(body.shiftId ?? "");
    if (!ID_RE.test(shiftId)) {
      return NextResponse.json({ error: "shiftId required" }, { status: 400 });
    }
    const claim = normaliseClaim(body);
    if (!claim) {
      return NextResponse.json({ error: "Your name is required." }, { status: 400 });
    }
    const pub = projectPublicClaim(body, now);
    if (!pub) {
      return NextResponse.json({ error: "Your name is required." }, { status: 400 });
    }

    const ref = col.doc(shiftId);
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("That shift no longer exists.");
        const data = snap.data() ?? {};
        const claims = (data.claims ?? []) as PublicClaim[];
        if (openSlots({ slots: Number(data.slots) || 0, claims }) <= 0) {
          throw new Error("That shift just filled up.");
        }
        // Same person twice is almost always a double-tap, not two volunteers.
        if (claims.some((c) => c.display_name === pub.display_name)) {
          throw new Error("You are already signed up for that shift.");
        }
        tx.update(ref, { claims: [...claims, pub] });
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Could not sign up." },
        { status: 409 },
      );
    }

    // Contact details live here, not on the public shift doc.
    await db.collection(`leagues/${leagueId}/snackbar_claims`).add({
      shift_id: shiftId,
      ...claim,
      display_name: pub.display_name,
      created_at: now,
    });

    return NextResponse.json({ ok: true, display_name: pub.display_name });
  }

  // ── public: release a slot ─────────────────────────────────────────
  // Matched on the display name the volunteer entered. Deliberately not an
  // authenticated action: there is no login for parents, and the cost of a
  // mistaken release is one empty snack-bar slot the league can see.
  if (action === "release") {
    const shiftId = String(body.shiftId ?? "");
    if (!ID_RE.test(shiftId)) {
      return NextResponse.json({ error: "shiftId required" }, { status: 400 });
    }
    const claim = normaliseClaim(body);
    const pub = claim ? projectPublicClaim({ name: claim.name }, now) : null;
    if (!pub) {
      return NextResponse.json({ error: "Your name is required." }, { status: 400 });
    }
    const ref = col.doc(shiftId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const claims = ((snap.data()?.claims ?? []) as PublicClaim[]).filter(
        (c) => c.display_name !== pub.display_name,
      );
      tx.update(ref, { claims });
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    {
      error:
        "action must be claim | release | save_shifts | delete_shift | generate_from_schedule | list_claims",
    },
    { status: 400 },
  );
}

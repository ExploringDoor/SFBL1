// POST /api/snack-bar
//
// Snack-bar volunteer shifts.
//
//   { leagueId, action: "claim", shiftId, name, email?, phone? }   public
//   { leagueId, action: "release", shiftId, name }                 public
//   { leagueId, action: "save_shifts", shifts: [...] }             admin
//   { leagueId, action: "delete_shift", shiftId }                  admin
//
// PII boundary: a claim's real name / email / phone are written to
// `snackbar_claims`, which no security rule grants public read on. Only the
// projection from lib/volunteer-shifts (first name + last initial) is written
// onto the world-readable shift doc. A parent volunteering to run the snack bar
// has not agreed to publish their phone number.
//
// Claims run through a transaction: two parents tapping the last slot at the
// same moment must not both get it.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import {
  projectPublicClaim,
  normaliseClaim,
  openSlots,
  type PublicClaim,
} from "@/lib/volunteer-shifts";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_SHIFTS = 400;

async function requireAdmin(req: Request, leagueId: string) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return null;
  try {
    const decoded = await getAdminAuth().verifyIdToken(m[1]!);
    const claim = (decoded.leagues as Record<string, string> | undefined)?.[leagueId];
    return claim === "admin" ? decoded : null;
  } catch {
    return null;
  }
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

  // ── admin: create / update shifts ──────────────────────────────────
  if (action === "save_shifts") {
    const decoded = await requireAdmin(req, leagueId);
    if (!decoded) return NextResponse.json({ error: "not admin" }, { status: 403 });

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
          slots: Math.max(1, Math.min(20, Number(s.slots) || 1)),
          note: String(s.note ?? "").trim().slice(0, 200),
          updated_at: now,
        },
        // merge so re-saving a shift never wipes the claims already on it
        { merge: true },
      );
      n += 1;
    }
    await batch.commit();
    return NextResponse.json({ ok: true, saved: n });
  }

  if (action === "delete_shift") {
    const decoded = await requireAdmin(req, leagueId);
    if (!decoded) return NextResponse.json({ error: "not admin" }, { status: 403 });
    const shiftId = String(body.shiftId ?? "");
    if (!ID_RE.test(shiftId)) {
      return NextResponse.json({ error: "shiftId required" }, { status: 400 });
    }
    await col.doc(shiftId).delete();
    return NextResponse.json({ ok: true });
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
    { error: "action must be claim | release | save_shifts | delete_shift" },
    { status: 400 },
  );
}

// POST /api/register — PUBLIC team registration submission.
//
// Unlike admin endpoints this takes no auth: any visitor on a tenant's site
// can submit. We validate hard and write to /leagues/{tenant}/registrations,
// which is an ADMIN-READ-ONLY collection (it holds coach PII — email/phone —
// so it must never be public-read). Tenant comes from the middleware-set
// x-tenant-id header, not the client.

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const AGE_GROUPS = ["7U", "8U", "9U", "10U", "11U", "12U", "13U", "14U"];

// 2027 fee schedule (confirmed by Doug 2026-06-18). Belongs in tenant
// config once the registration config shape lands.
const FEES: Record<"with_insurance" | "without_insurance", number> = {
  with_insurance: 495,
  without_insurance: 425,
};
// Optional add-on: USSSA membership.
const USSSA_FEE = 40;

const MAX = 200;

function clean(v: unknown, max = MAX): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > max) return null;
  return t;
}

export async function POST(req: Request) {
  const leagueId = req.headers.get("x-tenant-id");
  if (!leagueId || !/^[a-z0-9_-]+$/.test(leagueId)) {
    return NextResponse.json({ error: "Unknown league" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const type = body.registration_type;
  if (type !== "with_insurance" && type !== "without_insurance") {
    return NextResponse.json(
      { error: "Please choose a registration type." },
      { status: 400 },
    );
  }

  const hc = (body.head_coach ?? {}) as Record<string, unknown>;
  const name = clean(hc.name);
  const email = clean(hc.email);
  const phone = clean(hc.phone);
  if (!name) return bad("Head coach name is required.");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return bad("A valid head coach email is required.");
  if (!phone) return bad("Head coach phone is required.");

  const team = (body.team ?? {}) as Record<string, unknown>;
  const teamName = clean(team.name);
  const ageGroup = clean(team.age_group, 8);
  if (!teamName) return bad("Team name is required.");
  if (!ageGroup || !AGE_GROUPS.includes(ageGroup))
    return bad("Please select a valid age group.");
  const gcLink = clean(team.gamechanger_link, 300);
  if (!gcLink || !/^https?:\/\//i.test(gcLink))
    return bad("A GameChanger schedule link (URL) is required.");

  const comp = (body.compliance ?? {}) as Record<string, unknown>;
  if (comp.safesport !== true || comp.concussion !== true || comp.cardiac !== true) {
    return bad("All three training acknowledgments are required.");
  }

  const players = Number(team.estimated_players);
  const estimatedPlayers = Number.isFinite(players)
    ? Math.max(0, Math.min(40, Math.floor(players)))
    : null;

  const db = getAdminDb();
  const league = await db.doc(`leagues/${leagueId}`).get();
  if (!league.exists) {
    return NextResponse.json({ error: "Unknown league" }, { status: 404 });
  }

  const addUsssa = body.add_usssa === true;
  const baseFee = FEES[type];
  const usssaFee = addUsssa ? USSSA_FEE : 0;
  const total = baseFee + usssaFee;

  const doc = {
    status: "pending",
    submitted_at: new Date().toISOString(),
    season: "2027",
    registration_type: type,
    base_fee: baseFee,
    add_usssa: addUsssa,
    usssa_fee: usssaFee,
    fee: total,
    head_coach: {
      name,
      email,
      phone,
      street: clean(hc.street),
      city: clean(hc.city),
      state: clean(hc.state, 20),
      zip: clean(hc.zip, 12),
    },
    team: {
      name: teamName,
      age_group: ageGroup,
      gamechanger_link: gcLink,
      estimated_players: estimatedPlayers,
      prior_record: clean(team.prior_record, 40),
    },
    compliance: { safesport: true, concussion: true, cardiac: true },
  };

  const ref = await db.collection(`leagues/${leagueId}/registrations`).add(doc);
  return NextResponse.json({ ok: true, id: ref.id, fee: doc.fee });
}

function bad(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

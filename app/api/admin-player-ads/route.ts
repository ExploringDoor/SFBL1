// Player Ads moderation. Admin only.
//
// THIS ROUTE IS THE PII BOUNDARY. Ads are submitted through
// /api/league-form (kind: "player_ad") into
//   leagues/{id}/form_submissions/player_ad/items/{adId}
// which is default-deny at the rules layer, so the full payload — including
// the poster's name, email and phone — is only ever readable by the Admin SDK.
//
// Approving does NOT flip a flag on that private doc. It PROJECTS a new
// document into
//   leagues/{id}/player_ads/{adId}
// copying PUBLIC_AD_FIELDS and nothing else. The public collection therefore
// cannot leak contact details even if a future UI change renders every field
// it finds, because those fields are not in the document at all.
//
// Why that matters here specifically: these are 8U-18U players. A board that
// merely *hides* a minor's phone number in the markup is one careless `{...ad}`
// spread away from publishing it.
//
// Rejecting / unpublishing deletes the public doc and leaves the private
// submission intact, so the league keeps a record of what was posted.
//
// GET  ?leagueId=island        -> { ok, ads: [...] }   full payload, admin eyes
// POST { leagueId, id, decision: "approve" | "reject" | "pending" }

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { projectPublicAd } from "@/lib/player-ads";

export const runtime = "nodejs";


async function requireAdmin(req: Request, leagueId: string) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return { error: NextResponse.json({ error: "Missing bearer token" }, { status: 401 }) };
  }
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(auth.slice("Bearer ".length).trim());
  } catch {
    return { error: NextResponse.json({ error: "Invalid or expired token" }, { status: 401 }) };
  }
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[leagueId];
  if (claim !== "admin") {
    return {
      error: NextResponse.json(
        { error: `Not admin of league "${leagueId}"` },
        { status: 403 },
      ),
    };
  }
  return { decoded };
}

export async function GET(req: Request) {
  const leagueId = new URL(req.url).searchParams.get("leagueId") ?? "";
  if (!leagueId) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  const gate = await requireAdmin(req, leagueId);
  if (gate.error) return gate.error;

  const db = getAdminDb();
  const snap = await db
    .collection(`leagues/${leagueId}/form_submissions/player_ad/items`)
    .get();

  type AdRow = Record<string, unknown> & { id: string };
  const ads = snap.docs
    .map((d) => ({ ...(d.data() as Record<string, unknown>), id: d.id }) as AdRow)
    .filter((a: AdRow) => !a.deleted)
    .sort((a: AdRow, b: AdRow) =>
      String(b.submitted_at ?? "").localeCompare(String(a.submitted_at ?? "")),
    );

  return NextResponse.json({ ok: true, ads });
}

export async function POST(req: Request) {
  let body: { leagueId?: unknown; id?: unknown; decision?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { leagueId, id, decision } = body;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json({ error: "leagueId is required" }, { status: 400 });
  }
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (decision !== "approve" && decision !== "reject" && decision !== "pending") {
    return NextResponse.json(
      { error: "decision must be approve | reject | pending" },
      { status: 400 },
    );
  }

  const gate = await requireAdmin(req, leagueId);
  if (gate.error) return gate.error;

  const db = getAdminDb();
  const privateRef = db.doc(
    `leagues/${leagueId}/form_submissions/player_ad/items/${id}`,
  );
  const publicRef = db.doc(`leagues/${leagueId}/player_ads/${id}`);

  const snap = await privateRef.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Ad not found" }, { status: 404 });
  }
  const data = snap.data() ?? {};

  if (decision === "approve") {
    // Allow-list copy — see lib/player-ads.ts. Never spread `data`.
    const pub = projectPublicAd(data);
    pub.created_at = data.submitted_at ?? new Date().toISOString();
    pub.approved_at = new Date().toISOString();
    await publicRef.set(pub);
  } else {
    // Reject or send back to pending: the ad must leave the public board.
    await publicRef.delete().catch(() => {});
  }

  await privateRef.update({
    ad_status: decision === "approve" ? "approved" : decision,
    moderated_at: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true, status: decision });
}

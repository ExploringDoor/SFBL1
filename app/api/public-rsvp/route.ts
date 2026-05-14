// POST /api/public-rsvp — unauthed RSVP endpoint for LBDC's
// "no sign-in required" availability flow.
//
// Design trade-off: anyone who knows a player's name + team can
// mark RSVP for them. LBDC explicitly accepts this — their existing
// site has the same model and it's worked fine. We protect against
// abuse with:
//   1. Per-IP rate limit (matches /api/league-form: 30 / 10 min,
//      generous since a player might RSVP for several games at once)
//   2. Doc id format = `${game_id}_${player_id}` so repeat
//      submissions overwrite the same doc instead of accumulating
//   3. Tenant scoping from Host header (can't write to a tenant
//      you didn't visit)
//   4. Strict input validation — only the four allowed statuses,
//      lookup player + game existence before writing
//
// Body: { team_id, player_id, player_name, game_id, status }
// status ∈ ("yes" | "no" | "maybe" | "clear")
// "clear" deletes the doc instead of writing one.

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { parseHost, resolveTenant } from "@/lib/tenants";

export const runtime = "nodejs";

const rate = new Map<string, { count: number; reset: number }>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 30;

const ALLOWED_STATUSES = new Set(["yes", "no", "maybe", "clear"]);

interface Body {
  team_id?: unknown;
  player_id?: unknown;
  player_name?: unknown;
  game_id?: unknown;
  status?: unknown;
}

export async function POST(req: Request) {
  // Resolve tenant from Host (mirrors /api/league-form, /api/schedule.ics).
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const tenant = await resolveTenant(parseHost(host));
  if (!tenant) {
    return NextResponse.json({ error: "no tenant" }, { status: 400 });
  }
  const tenantId = tenant.id;

  // Per-IP rate limit.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const entry = rate.get(ip);
  if (entry && now < entry.reset) {
    if (entry.count >= RATE_LIMIT) {
      return NextResponse.json(
        { error: "Too many RSVPs. Wait a few minutes and try again." },
        { status: 429 },
      );
    }
    entry.count++;
  } else {
    rate.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const team_id = typeof body.team_id === "string" ? body.team_id : "";
  const player_id =
    typeof body.player_id === "string" ? body.player_id : "";
  const player_name =
    typeof body.player_name === "string" ? body.player_name : "";
  const game_id = typeof body.game_id === "string" ? body.game_id : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!team_id || !player_id || !game_id || !player_name) {
    return NextResponse.json(
      { error: "team_id, player_id, player_name, game_id required" },
      { status: 400 },
    );
  }
  if (!ALLOWED_STATUSES.has(status)) {
    return NextResponse.json(
      { error: "status must be yes | no | maybe | clear" },
      { status: 400 },
    );
  }
  if (
    !/^[a-z0-9-_]+$/i.test(team_id) ||
    !/^[a-z0-9-_]+$/i.test(player_id) ||
    !/^[a-z0-9-_]+$/i.test(game_id)
  ) {
    return NextResponse.json({ error: "bad id chars" }, { status: 400 });
  }

  const db = getAdminDb();
  // Verify the player + game actually exist in this tenant — stops
  // someone POSTing junk ids to fill the collection.
  const [playerSnap, gameSnap] = await Promise.all([
    db.doc(`leagues/${tenantId}/players/${player_id}`).get(),
    db.doc(`leagues/${tenantId}/games/${game_id}`).get(),
  ]);
  if (!playerSnap.exists) {
    return NextResponse.json({ error: "unknown player_id" }, { status: 404 });
  }
  if (!gameSnap.exists) {
    return NextResponse.json({ error: "unknown game_id" }, { status: 404 });
  }
  // Don't trust the client-supplied team_id — read it off the player
  // doc so we always tag the RSVP with the canonical team.
  const canonTeamId = String(playerSnap.data()?.team_id ?? team_id);

  const docId = `${game_id}_${player_id}`;
  const ref = db.doc(`leagues/${tenantId}/availability/${docId}`);

  if (status === "clear") {
    await ref.delete();
    return NextResponse.json({ ok: true, cleared: true });
  }

  await ref.set(
    {
      tenant: tenantId,
      team_id: canonTeamId,
      player_id,
      player_name,
      game_id,
      status,
      updated_at: new Date().toISOString(),
      source: "public-rsvp",
    },
    { merge: true },
  );

  return NextResponse.json({ ok: true });
}

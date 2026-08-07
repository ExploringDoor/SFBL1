// GET /api/admin-activity?leagueId=… — one chronological feed of everything
// happening in the league.
//
// Adam asked for this on 2026-08-07, modelled on the Activity tab in the
// Small Town Select and Texas Select admins.
//
// DERIVED, not logged. Those sites append to an `activity` collection as each
// API route fires. That means (a) every write path has to remember to log, and
// (b) the feed starts empty and can never show anything that happened before
// it was built. Here the feed is assembled on read from the records that
// already exist, so it works retroactively — COYBL's first registration and
// its Venmo payment show up without anything having been instrumented — and
// no existing route needs touching. Cost is one fan-out read per load, which
// is fine for an admin screen nobody leaves open.
//
// Admin-only: it exposes coach contact details and payment amounts.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Kind =
  | "registration"
  | "payment"
  | "score"
  | "game"
  | "roster"
  | "message"
  | "feedback"
  | "signup"
  | "ad"
  | "login";

interface Item {
  id: string;
  kind: Kind;
  at: string;
  title: string;
  detail?: string;
  /** Admin tab this belongs to, so a row can deep-link where it is actioned. */
  tab?: string;
}

/** Firestore timestamps arrive as ISO strings, Timestamps, or nothing. */
function when(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  const t = v as { toDate?: () => Date; seconds?: number };
  if (typeof t.toDate === "function") return t.toDate().toISOString();
  if (typeof t.seconds === "number") return new Date(t.seconds * 1000).toISOString();
  return "";
}

const money = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? `$${v.toFixed(2).replace(/\.00$/, "")}` : "";
};

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(auth.slice(7).trim());
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const leagueId = new URL(req.url).searchParams.get("leagueId") ?? "";
  if (!/^[a-z0-9_-]+$/.test(leagueId)) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[leagueId];
  if (claim !== "admin") {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const db = getAdminDb();
  const base = `leagues/${leagueId}`;

  // Everything at once. Each failure degrades to an empty list rather than
  // failing the whole feed — a missing collection on a new tenant is normal.
  const none = { docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] };
  const [regs, pays, games, msgs, feedback, ads, teams, players] = await Promise.all([
    db.collection(`${base}/form_submissions/team_registration/items`).get().catch(() => none),
    db.collection(`${base}/team_payments`).get().catch(() => none),
    db.collection(`${base}/games`).get().catch(() => none),
    db.collection(`${base}/team_messages`).get().catch(() => none),
    db.collection(`${base}/form_submissions/site_feedback/items`).get().catch(() => none),
    db.collection(`${base}/form_submissions/player_ad/items`).get().catch(() => none),
    db.collection(`${base}/teams`).get().catch(() => none),
    db.collection(`${base}/players`).get().catch(() => none),
  ]);

  const teamName = new Map<string, string>();
  teams.docs.forEach((d) => teamName.set(d.id, String(d.data().name ?? d.id)));

  const items: Item[] = [];

  for (const d of regs.docs) {
    const x = d.data();
    const who = [x.manager_first_name, x.manager_last_name].filter(Boolean).join(" ");
    items.push({
      id: `reg:${d.id}`,
      kind: "registration",
      at: when(x.created_at ?? x.submitted_at),
      title: `${x.team_name ?? "A team"} registered`,
      detail: [x.age_group, who && `coach ${who}`].filter(Boolean).join(" · "),
      tab: "forms",
    });
  }

  for (const d of pays.docs) {
    const x = d.data();
    const paid = when(x.paid_at);
    if (!paid) continue; // owed but unpaid is a state, not an event
    const method = String(x.method ?? "").trim();
    items.push({
      id: `pay:${d.id}`,
      kind: "payment",
      at: paid,
      title: `${x.team_name ?? teamName.get(d.id) ?? "A team"} paid`,
      detail: [money(x.amount_paid), method && `by ${method}`].filter(Boolean).join(" "),
      tab: "payments",
    });
  }

  for (const d of games.docs) {
    const x = d.data();
    const home = teamName.get(String(x.home_team_id)) ?? "Home";
    const away = teamName.get(String(x.away_team_id)) ?? "Away";
    const scored = when(x.score_submitted_at ?? x.updated_at);
    const hasScore = x.home_score != null && x.away_score != null;
    if (hasScore && scored) {
      items.push({
        id: `score:${d.id}`,
        kind: "score",
        at: scored,
        title: `Final: ${away} ${x.away_score} at ${home} ${x.home_score}`,
        detail: String(x.date ?? ""),
        tab: "scores",
      });
    }
    const made = when(x.created_at);
    if (made) {
      items.push({
        id: `game:${d.id}`,
        kind: "game",
        at: made,
        title: `Game posted: ${away} at ${home}`,
        detail: [x.date, x.time, x.field].filter(Boolean).join(" · "),
        tab: "schedule",
      });
    }
  }

  for (const d of msgs.docs) {
    const x = d.data();
    items.push({
      id: `msg:${d.id}`,
      kind: "message",
      at: when(x.created_at),
      title: `${x.team_name ?? "A coach"} emailed their families`,
      detail: [String(x.subject ?? ""), x.recipient_count ? `${x.recipient_count} sent` : ""]
        .filter(Boolean)
        .join(" · "),
    });
  }

  for (const d of feedback.docs) {
    const x = d.data();
    items.push({
      id: `fb:${d.id}`,
      kind: "feedback",
      at: when(x.created_at ?? x.submitted_at),
      title: `Site feedback: ${x.topic ?? "a suggestion"}`,
      detail: String(x.message ?? "").slice(0, 90),
      tab: "forms",
    });
  }

  for (const d of ads.docs) {
    const x = d.data();
    items.push({
      id: `ad:${d.id}`,
      kind: "ad",
      at: when(x.created_at ?? x.submitted_at),
      title: `New board post: ${x.kind ?? "ad"}`,
      detail: String(x.message ?? x.note ?? "").slice(0, 90),
      tab: "player-ads",
    });
  }

  // Roster growth, rolled up per team per day. One row per player would drown
  // everything else the moment a coach types in twelve names.
  const byTeamDay = new Map<string, { at: string; team: string; n: number }>();
  for (const d of players.docs) {
    const x = d.data();
    const at = when(x.created_at);
    if (!at) continue;
    const team = teamName.get(String(x.team_id)) ?? "";
    if (!team) continue;
    const key = `${x.team_id}:${at.slice(0, 10)}`;
    const cur = byTeamDay.get(key);
    if (cur) {
      cur.n += 1;
      if (at > cur.at) cur.at = at;
    } else byTeamDay.set(key, { at, team, n: 1 });
  }
  for (const [key, v] of byTeamDay) {
    items.push({
      id: `roster:${key}`,
      kind: "roster",
      at: v.at,
      title: `${v.team} added ${v.n} player${v.n === 1 ? "" : "s"}`,
      tab: "teams",
    });
  }

  const feed = items
    .filter((i) => i.at)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 400);

  return NextResponse.json({ ok: true, items: feed });
}

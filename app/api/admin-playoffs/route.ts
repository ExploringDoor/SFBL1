// /api/admin-playoffs — admin manages the per-league playoff bracket.
//
// Stored as a single doc at /leagues/{id}/site_config/playoffs:
//   {
//     active: boolean,         // public /playoffs page hides itself when false
//     title: string,           // e.g. "2026 Spring Playoffs"
//     divisions: [
//       {
//         label: "18+",
//         rounds: [
//           {
//             label: "Quarterfinals",
//             matches: [
//               {
//                 id: "m1",
//                 away_team_id: "margate-marlins",
//                 away_seed: 1,
//                 home_team_id: "broward-yankees",
//                 home_seed: 8,
//                 game_id?: "g-9001",     // optional link to the game doc
//                 away_score?: 7,         // populated as games complete
//                 home_score?: 4,
//                 winner_team_id?: "margate-marlins",
//                 status: "scheduled" | "live" | "final"
//               },
//               …
//             ]
//           },
//           …
//         ]
//       },
//       …
//     ]
//   }
//
// Auth: admin only. Single endpoint, replaces whole structure on
// each save (admin manages additions / removals client-side).

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

interface BracketDoc {
  active: boolean;
  title: string;
  divisions: {
    label: string;
    rounds: {
      label: string;
      matches: {
        id: string;
        away_team_id?: string | null;
        away_seed?: number | null;
        home_team_id?: string | null;
        home_seed?: number | null;
        game_id?: string | null;
        away_score?: number | null;
        home_score?: number | null;
        winner_team_id?: string | null;
        status?: "scheduled" | "live" | "final";
      }[];
    }[];
  }[];
}

const ALLOWED_STATUS = new Set(["scheduled", "live", "final"]);

export async function POST(req: Request) {
  const authHdr = req.headers.get("authorization");
  if (!authHdr?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing bearer token" },
      { status: 401 },
    );
  }
  const idToken = authHdr.slice("Bearer ".length).trim();

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: { leagueId?: unknown; bracket?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400 },
    );
  }
  if (
    (decoded.leagues as Record<string, string> | undefined)?.[leagueId] !==
    "admin"
  ) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  // Validate + normalize.
  const raw = body.bracket as Partial<BracketDoc> | undefined;
  if (!raw || typeof raw !== "object") {
    return NextResponse.json(
      { error: "bracket must be an object" },
      { status: 400 },
    );
  }
  const cleaned: BracketDoc = {
    active: raw.active === true,
    title: typeof raw.title === "string" ? raw.title.trim() : "Playoffs",
    divisions: [],
  };
  if (Array.isArray(raw.divisions)) {
    for (const div of raw.divisions) {
      if (!div || typeof div !== "object") continue;
      const dLabel = typeof div.label === "string" ? div.label.trim() : "";
      const rounds: BracketDoc["divisions"][number]["rounds"] = [];
      if (Array.isArray(div.rounds)) {
        for (const round of div.rounds) {
          if (!round || typeof round !== "object") continue;
          const rLabel =
            typeof round.label === "string" ? round.label.trim() : "";
          const matches: BracketDoc["divisions"][number]["rounds"][number]["matches"] =
            [];
          if (Array.isArray(round.matches)) {
            for (const m of round.matches) {
              if (!m || typeof m !== "object") continue;
              const status =
                typeof m.status === "string" && ALLOWED_STATUS.has(m.status)
                  ? (m.status as "scheduled" | "live" | "final")
                  : "scheduled";
              matches.push({
                id:
                  typeof m.id === "string" && m.id
                    ? m.id
                    : `m_${Math.random().toString(36).slice(2, 8)}`,
                away_team_id:
                  typeof m.away_team_id === "string" ? m.away_team_id : null,
                away_seed:
                  typeof m.away_seed === "number" ? m.away_seed : null,
                home_team_id:
                  typeof m.home_team_id === "string" ? m.home_team_id : null,
                home_seed:
                  typeof m.home_seed === "number" ? m.home_seed : null,
                game_id: typeof m.game_id === "string" ? m.game_id : null,
                away_score:
                  typeof m.away_score === "number" ? m.away_score : null,
                home_score:
                  typeof m.home_score === "number" ? m.home_score : null,
                winner_team_id:
                  typeof m.winner_team_id === "string"
                    ? m.winner_team_id
                    : null,
                status,
              });
            }
          }
          rounds.push({ label: rLabel, matches });
        }
      }
      cleaned.divisions.push({ label: dLabel, rounds });
    }
  }

  const db = getAdminDb();
  await db.doc(`leagues/${leagueId}/site_config/playoffs`).set({
    ...cleaned,
    updated_at: new Date().toISOString(),
    updated_by_uid: decoded.uid,
  });
  await db.collection(`leagues/${leagueId}/audit`).add({
    kind: "playoffs_update",
    by_uid: decoded.uid,
    by_role: "admin",
    changes: {
      active: cleaned.active,
      divisions: cleaned.divisions.length,
    },
    at: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true });
}

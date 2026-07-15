// Public playoff bracket page. Renders the Small Town Selects / PA D27
// style bracket (absolute cards + SVG connectors) the admin builds at
// /admin → Playoffs. Auto-hides when bracket.active is false (regular
// season — nothing to show). Game date/field/time + team logos come from
// the linked scheduled game (match.game_id) / team docs, and each matchup
// links to that game's preview/recap page.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { loadGamesAndTeamsSnaps } from "@/lib/league-cache";
import { formatGameDate, formatTime12 } from "@/lib/format-time";
import {
  PlayoffsBracket,
  type BracketDivision,
  type BracketGameInfo,
} from "@/components/ui/PlayoffsBracket";
import "./playoffs.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Playoffs",
  description: "Playoff bracket and results.",
};

interface Bracket {
  active: boolean;
  title: string;
  divisions: BracketDivision[];
}

// "Sun 7/19" + "9:30 AM" for a game's date/time (handles both the
// separate-time shape and combined-ISO UTC, rendered in league time).
function gameMeta(
  date: string,
  time: string,
  field: string | null,
): BracketGameInfo {
  const dateLabel = formatGameDate(date || null, time || null, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  let timeLabel = "";
  if (time && /^\d{1,2}:\d{2}/.test(time)) {
    timeLabel = formatTime12(time);
  } else if (/T\d{2}:\d{2}/.test(date)) {
    const d = new Date(date);
    if (!Number.isNaN(d.getTime())) {
      timeLabel = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
      }).format(d);
    }
  }
  return { dateLabel, timeLabel, field: field || null };
}

export default async function PlayoffsPage() {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

  const db = getAdminDb();
  const [bracketSnap, { gamesSnap, teamsSnap }] = await Promise.all([
    db.doc(`leagues/${tenantId}/site_config/playoffs`).get(),
    loadGamesAndTeamsSnaps(db, tenantId),
  ]);

  const bracket: Bracket | null = bracketSnap.exists
    ? {
        active: bracketSnap.data()?.active === true,
        title: String(bracketSnap.data()?.title ?? "Playoffs"),
        divisions: (bracketSnap.data()?.divisions ?? []) as BracketDivision[],
      }
    : null;

  if (!bracket || !bracket.active) {
    return (
      <main className="po-shell">
        <header className="po-header">
          <h1 className="po-title">Playoffs</h1>
        </header>
        <p className="po-empty">
          Playoff bracket isn&apos;t published yet. Check back later in the
          season.
        </p>
      </main>
    );
  }

  const teamName: Record<string, string> = {};
  const teamLogo: Record<string, string | null> = {};
  for (const d of teamsSnap.docs) {
    const data = d.data();
    teamName[d.id] = String(data.name ?? d.id);
    teamLogo[d.id] = data.logo_url ? String(data.logo_url) : null;
  }

  const gameInfo: Record<string, BracketGameInfo> = {};
  for (const d of gamesSnap.docs) {
    const data = d.data();
    gameInfo[d.id] = gameMeta(
      data.date ? String(data.date) : "",
      data.time ? String(data.time) : "",
      data.field ? String(data.field) : null,
    );
  }

  // Bracket matches store no game_id, so link each one to its scheduled
  // playoff game by the (unordered) team pair. This makes the cards clickable
  // through to the game preview/recap and fills in the real date/field.
  // Keyed by the two team ids sorted; a "tbd"/empty side is a wildcard, so a
  // half-filled matchup (winner vs a #1-seed bye) still resolves. All-TBD and
  // ambiguous (non-unique) pairs are skipped.
  const pairKey = (a: string | null, b: string | null) =>
    [a || "tbd", b || "tbd"].sort().join("__");
  const bothTbd = (a: string | null, b: string | null) =>
    (!a || a === "tbd") && (!b || b === "tbd");

  const gameIdByPair = new Map<string, string | null>(); // null = ambiguous
  for (const d of gamesSnap.docs) {
    const data = d.data();
    if (data.is_playoff !== true) continue;
    const a = data.away_team_id ? String(data.away_team_id) : null;
    const h = data.home_team_id ? String(data.home_team_id) : null;
    if (bothTbd(a, h)) continue; // e.g. an unseeded "TBD vs TBD" final
    const key = pairKey(a, h);
    gameIdByPair.set(key, gameIdByPair.has(key) ? null : d.id);
  }

  const linkedDivisions = bracket.divisions.map((div) => ({
    ...div,
    rounds: (div.rounds ?? []).map((r) => ({
      ...r,
      matches: (r.matches ?? []).map((m) => {
        if (m.game_id || bothTbd(m.away_team_id, m.home_team_id)) return m;
        const gid = gameIdByPair.get(pairKey(m.away_team_id, m.home_team_id));
        return gid ? { ...m, game_id: gid } : m;
      }),
    })),
  }));

  return (
    <main className="po-shell">
      <header className="po-header">
        <h1 className="po-title">{bracket.title}</h1>
      </header>

      {linkedDivisions.length === 0 ? (
        <p className="po-empty">No divisions configured yet.</p>
      ) : (
        <PlayoffsBracket
          divisions={linkedDivisions}
          teamName={teamName}
          teamLogo={teamLogo}
          gameInfo={gameInfo}
        />
      )}
    </main>
  );
}

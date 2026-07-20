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

// A real team id, or null for any flavor of "not decided yet" ("", "tbd").
function teamId(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" || s.toLowerCase() === "tbd" ? null : s;
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

  // Results keyed by game id, so a played playoff game can fill in its
  // bracket card's score/winner. A game only counts as decided once it's
  // final/approved AND both scores are actually present — an unplayed game
  // stores no score at all, which must not read as 0-0.
  interface GameResultRow {
    away: string | null;
    home: string | null;
    awayScore: number | null;
    homeScore: number | null;
    decided: boolean;
  }
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const gameResult = new Map<string, GameResultRow>();
  for (const d of gamesSnap.docs) {
    const data = d.data();
    const awayScore = num(data.away_score);
    const homeScore = num(data.home_score);
    const status = String(data.status ?? "");
    gameResult.set(d.id, {
      away: teamId(data.away_team_id),
      home: teamId(data.home_team_id),
      awayScore,
      homeScore,
      decided:
        (status === "final" || status === "approved") &&
        awayScore !== null &&
        homeScore !== null,
    });
  }

  // Bracket matches store no game_id, so link each one to its scheduled
  // playoff game by the (unordered) team pair. This makes the cards clickable
  // through to the game preview/recap and fills in the real date/field.
  // Keyed by the two team ids sorted; a "tbd"/empty side is a wildcard, so a
  // half-filled matchup (winner vs a #1-seed bye) still resolves. All-TBD and
  // ambiguous (non-unique) pairs are skipped.
  const pairKey = (a: string | null, b: string | null) =>
    [a || "tbd", b || "tbd"].sort().join("__");
  const bothTbd = (a: string | null, b: string | null) => !a && !b;

  const gameIdByPair = new Map<string, string | null>(); // null = ambiguous
  for (const d of gamesSnap.docs) {
    const data = d.data();
    if (data.is_playoff !== true) continue;
    const a = teamId(data.away_team_id);
    const h = teamId(data.home_team_id);
    if (bothTbd(a, h)) continue; // e.g. an unseeded "TBD vs TBD" final
    const key = pairKey(a, h);
    gameIdByPair.set(key, gameIdByPair.has(key) ? null : d.id);
  }

  // Resolve each division round by round, because a round's game link can
  // only be found once the previous round's winners are known: a card that
  // reads "TBD vs Delray" matches no scheduled game until the semifinal
  // winner lands in that slot. So per round, in order: (1) advance decided
  // winners into open slots, (2) link the card to its scheduled game by
  // team pair, (3) copy that game's score/winner onto the card.
  //
  // Anything the admin typed by hand wins — we only fill blanks, so a
  // manually corrected score or an overturned result is never clobbered.
  const seedOf = (m: (typeof bracket.divisions)[number]["rounds"][number]["matches"][number] | undefined) =>
    !m || !m.winner_team_id
      ? null
      : m.winner_team_id === m.away_team_id
        ? m.away_seed
        : m.home_seed;

  const linkedDivisions = bracket.divisions.map((div) => {
    const rounds = (div.rounds ?? []).map((r) => ({
      ...r,
      matches: (r.matches ?? []).map((m) => ({
        ...m,
        away_team_id: teamId(m.away_team_id),
        home_team_id: teamId(m.home_team_id),
      })),
    }));

    rounds.forEach((round, ri) => {
      const prev = ri > 0 ? (rounds[ri - 1]?.matches ?? []) : [];
      round.matches.forEach((m, j) => {
        // (1) Match j is fed by matches 2j / 2j+1 of the previous round.
        if (ri > 0) {
          const fA = prev[2 * j];
          const fB = prev[2 * j + 1];
          if (m.away_team_id == null && fA?.winner_team_id) {
            m.away_team_id = fA.winner_team_id;
            m.away_seed = seedOf(fA);
          }
          if (m.home_team_id == null && fB?.winner_team_id) {
            m.home_team_id = fB.winner_team_id;
            m.home_seed = seedOf(fB);
          }
        }

        // (2) Link to the scheduled playoff game for this pairing.
        if (!m.game_id && !bothTbd(m.away_team_id, m.home_team_id)) {
          const gid = gameIdByPair.get(pairKey(m.away_team_id, m.home_team_id));
          if (gid) m.game_id = gid;
        }

        // (3) Carry the played result onto the card. The game's home/away
        // may be the reverse of how the bracket lists the matchup, so
        // orient the scores by team id rather than trusting the order.
        const g = m.game_id ? gameResult.get(m.game_id) : undefined;
        if (!g || !g.decided) return;
        const flipped =
          m.away_team_id != null && m.away_team_id === g.home && g.home !== g.away;
        const awayScore = flipped ? g.homeScore : g.awayScore;
        const homeScore = flipped ? g.awayScore : g.homeScore;
        if (m.away_score == null) m.away_score = awayScore;
        if (m.home_score == null) m.home_score = homeScore;
        if (m.status !== "final") m.status = "final";
        if (
          !m.winner_team_id &&
          awayScore != null &&
          homeScore != null &&
          awayScore !== homeScore
        ) {
          m.winner_team_id =
            awayScore > homeScore ? m.away_team_id : m.home_team_id;
        }
      });
    });

    return { ...div, rounds };
  });

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

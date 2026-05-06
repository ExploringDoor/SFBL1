// Pure helpers for the captain dashboard's "Awaiting your score"
// section — the prominent CTA that shows games this captain hasn't
// scored yet.
//
// Why this lives in /lib:
//   The captain page is a 900-line client component; pulling these
//   helpers out lets us unit-test the filtering logic without
//   spinning up the whole dashboard. DVSL §9 from the peer review
//   flagged this as the #1 captain UX gap (DVSL captains constantly
//   ask "where do I submit my score?").
//
// What "awaiting score" means:
//   1. The captain's team is one of the two participants in the game.
//   2. The game's scheduled date has passed (we don't show
//      pre-emptive "submit score" CTAs for tonight's game).
//   3. The game's status is NOT a terminal final state ("final"
//      or "approved"). If both captains have submitted, status is
//      flipped to "final" and the game falls off this list.
//
// We deliberately do NOT check whether THIS captain has individually
// submitted — both captains in a not-yet-final game see the CTA, so
// both get nudged. If only one captain has submitted, the
// not-yet-submitted captain still sees their game here, and the
// already-submitted captain sees a "you submitted; waiting for the
// other captain" hint instead. (That hint is added by the consumer.)

export interface CaptainGame {
  id: string;
  date: string | null;
  status: string;
  away_team_id: string;
  home_team_id: string;
}

export interface AwaitingScoreEntry<G extends CaptainGame> {
  game: G;
  /** "home" or "away" — which side this captain is on. */
  side: "home" | "away";
}

const FINAL_STATES = new Set(["final", "approved"]);

/** Parses an ISO date string ("2026-05-10" or full datetime) to a
 *  Date with NO time-zone shenanigans. Treats date-only inputs as
 *  midnight UTC so a captain doesn't see a "past" game flip on TZ. */
function parseGameDate(s: string | null): Date | null {
  if (!s) return null;
  // Already has time? Use as-is.
  if (s.includes("T") || s.includes(" ")) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Bare YYYY-MM-DD: anchor to UTC noon to avoid DST/TZ edge cases
  // pushing it into yesterday or tomorrow for some users.
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Filter the captain's full game list to ones awaiting a score.
 *  Sorted oldest-first (the most urgent ones surface first — a 3-week
 *  -old un-scored game is more pressing than yesterday's). */
export function awaitingScoreGames<G extends CaptainGame>(
  games: G[],
  myTeamId: string,
  today: Date = new Date(),
): AwaitingScoreEntry<G>[] {
  const out: AwaitingScoreEntry<G>[] = [];
  for (const g of games) {
    // Must be in this captain's matchup.
    const isAway = g.away_team_id === myTeamId;
    const isHome = g.home_team_id === myTeamId;
    if (!isAway && !isHome) continue;
    // Must be past terminal state.
    if (FINAL_STATES.has(g.status)) continue;
    // Must have an actual date in the past.
    const d = parseGameDate(g.date);
    if (d == null) continue;
    if (d.getTime() > today.getTime()) continue;

    out.push({ game: g, side: isAway ? "away" : "home" });
  }
  // Oldest-first so the longest-pending games surface at the top.
  out.sort((a, b) => {
    const ad = parseGameDate(a.game.date)?.getTime() ?? 0;
    const bd = parseGameDate(b.game.date)?.getTime() ?? 0;
    return ad - bd;
  });
  return out;
}

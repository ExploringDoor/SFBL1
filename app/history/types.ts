// Shared types between the server page (`page.tsx`) and the client
// view (`HistoryView.tsx`). Pulled out so both can import without
// the client component pulling in any server-only modules.

export interface StandingRow {
  team: string;
  w: number;
  l: number;
  t: number;
  g: number;
  pct: string; // ".917"
  p: number; // points
}

export interface StandingsBlock {
  season: string; // e.g. "Spring - 2024"
  game_type: "season" | "playoff";
  division: string; // "" for [No Division]
  standings: StandingRow[];
}

export interface TeamMeta {
  id: string;
  name: string;
  color: string | null;
  logoUrl: string | null;
}

export interface ChampionRow {
  season: string;
  divisions: {
    division: string;
    team: string;
    /** The winner's record that season, e.g. "11-2" or "9-3-1". Absent for
     *  leagues whose archive states a bracket WINNER but no bracket record —
     *  printing an invented record beside a real champion is worse than
     *  printing none. */
    record?: string;
    /** Current-day team match (logo + brand color + link). null when
     *  the historical team name doesn't appear on any active club. */
    meta: TeamMeta | null;
    /** Beaten finalist, when the league publishes one. Some archives print a
     *  runner-up banner alongside the champion. */
    runnerUp?: string | null;
    runnerUpMeta?: TeamMeta | null;
    /** True when the SOURCE contradicts itself about who won (e.g. two pages
     *  both captioned champion). Surfaced rather than silently resolved, so a
     *  disputed title is never presented as settled fact. */
    disputed?: boolean;
  }[];
}

export interface LeaderboardRow {
  team: string;
  meta: TeamMeta | null;
  /** Generic count value: # championships, # wins, etc. */
  count: number;
  /** Optional sub-text for the row (seasons list, season-count, etc.). */
  detail: string[];
}

/** A completed game kept for the archive after the live season is cleared. */
export interface ArchivedGame {
  date: string;
  time?: string;
  ageGroup?: string;
  division?: string;
  home: string;
  away: string;
  home_score?: number | null;
  away_score?: number | null;
  /**
   * Set false when the source never recorded WHICH side was at home, so the
   * two teams are in reading order only. The renderer then separates them with
   * "vs" instead of "at" — writing "A at B" would assert a home team the
   * archive does not contain. Omitted/true keeps the normal "at".
   */
  orientation_known?: boolean;
  status?: string;
  field?: string | null;
}

export interface HistoryViewProps {
  all: StandingsBlock[];
  /** Past-season game results, newest season first. Empty for tenants with
   *  no archived games, which hides the Scores tab entirely. */
  archivedGames?: { season: string; games: ArchivedGame[] }[];
  /** name-lowercased → current team meta, for logos / colors. */
  nameIdx: Record<string, TeamMeta>;
  champions: ChampionRow[];
  championsLb: LeaderboardRow[];
  winsLb: LeaderboardRow[];
  /** What the top of each block actually represents. Leagues with a recorded
   *  playoff bracket crown champions; leagues that only keep regular season
   *  standings (COYBL) have division winners. Drives the wording only. */
  honourLabel?: "champion" | "division-winner";
  /** Seasons that have a full per-year bracket page at /history/{year}.
   *  Empty for tenants with no playoff archive, which leaves season labels
   *  as plain text exactly as before. */
  bracketYears?: number[];
  /** Chronological champion photo slides for the rolling slideshow. Empty for
   *  tenants with no champion photos, which hides the slideshow. */
  championSlides?: import("@/components/ChampionsSlideshow").ChampionSlide[];
  /** Branded trophy image for the Champions tab (LCYBL). When absent the tab
   *  keeps its generic 🏆 emoji. */
  trophyUrl?: string;
  stats: {
    seasonCount: number;
    oldestYear: string;
    totalChampionships: number;
    teamCount: number;
  };
}

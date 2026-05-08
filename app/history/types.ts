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
    /** Current-day team match (logo + brand color + link). null when
     *  the historical team name doesn't appear on any active club. */
    meta: TeamMeta | null;
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

export interface HistoryViewProps {
  all: StandingsBlock[];
  /** name-lowercased → current team meta, for logos / colors. */
  nameIdx: Record<string, TeamMeta>;
  champions: ChampionRow[];
  championsLb: LeaderboardRow[];
  winsLb: LeaderboardRow[];
  stats: {
    seasonCount: number;
    oldestYear: string;
    totalChampionships: number;
    teamCount: number;
  };
}

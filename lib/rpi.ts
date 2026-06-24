// RPI power rankings (Ratings Percentage Index) — the same method travel-ball
// rankings services (incl. EvenField) and the NCAA use. Pure functions over a
// set of game results, so it's testable in isolation and source-agnostic:
// feed it whatever games are on the platform (entered on-site, imported, etc.).
//
//   RPI = 0.25·WP + 0.50·OWP + 0.25·OOWP
//
//   WP   = team's win pct (ties = 0.5)
//   OWP  = avg win pct of opponents, each computed WITHOUT games vs this team
//   OOWP = avg OWP of opponents
//
// 75% of the score is strength of schedule (OWP + OOWP), so a strong-schedule
// team can outrank a team with a gaudier record.

export interface RpiGame {
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  status: string;
}

export interface RpiRow {
  team_id: string;
  rpi: number;
  wp: number;
  owp: number;
  oowp: number;
  w: number;
  l: number;
  t: number;
  gp: number;
}

const W_WP = 0.25;
const W_OWP = 0.5;
const W_OOWP = 0.25;

/** Win share for a team in a game: 1 win, 0.5 tie, 0 loss. */
function winShare(g: RpiGame, teamId: string): number {
  const us = g.home_team_id === teamId ? g.home_score : g.away_score;
  const them = g.home_team_id === teamId ? g.away_score : g.home_score;
  if (us > them) return 1;
  if (us < them) return 0;
  return 0.5;
}

function opponent(g: RpiGame, teamId: string): string {
  return g.home_team_id === teamId ? g.away_team_id : g.home_team_id;
}

/**
 * Compute RPI rankings for every team appearing in `games`. Only counted
 * games (final/approved) are used. Returns rows sorted by RPI descending,
 * ties broken by win pct then team id.
 */
export function computeRpi(games: RpiGame[]): RpiRow[] {
  const counted = games.filter((g) => g.status === "final" || g.status === "approved");

  const byTeam = new Map<string, RpiGame[]>();
  for (const g of counted) {
    for (const id of [g.home_team_id, g.away_team_id]) {
      if (!id) continue;
      if (!byTeam.has(id)) byTeam.set(id, []);
      byTeam.get(id)!.push(g);
    }
  }

  // Win pct over an explicit subset of a team's games.
  const wpOver = (teamId: string, subset: RpiGame[]): number => {
    if (subset.length === 0) return 0;
    let s = 0;
    for (const g of subset) s += winShare(g, teamId);
    return s / subset.length;
  };

  const wp = (teamId: string): number => wpOver(teamId, byTeam.get(teamId) ?? []);

  // Opponent's WP excluding any games played against `vs`.
  const wpExcluding = (teamId: string, vs: string): number => {
    const subset = (byTeam.get(teamId) ?? []).filter((g) => opponent(g, teamId) !== vs);
    return wpOver(teamId, subset);
  };

  // OWP(team) = avg over the team's games of the opponent's WP-excluding-team.
  const owp = (teamId: string): number => {
    const gs = byTeam.get(teamId) ?? [];
    if (gs.length === 0) return 0;
    let s = 0;
    for (const g of gs) s += wpExcluding(opponent(g, teamId), teamId);
    return s / gs.length;
  };

  // OOWP(team) = avg over the team's games of each opponent's OWP.
  const oowp = (teamId: string): number => {
    const gs = byTeam.get(teamId) ?? [];
    if (gs.length === 0) return 0;
    let s = 0;
    for (const g of gs) s += owp(opponent(g, teamId));
    return s / gs.length;
  };

  const rows: RpiRow[] = [];
  for (const [teamId, gs] of byTeam) {
    let w = 0;
    let l = 0;
    let t = 0;
    for (const g of gs) {
      const share = winShare(g, teamId);
      if (share === 1) w++;
      else if (share === 0) l++;
      else t++;
    }
    const teamWp = wp(teamId);
    const teamOwp = owp(teamId);
    const teamOowp = oowp(teamId);
    const rpi = W_WP * teamWp + W_OWP * teamOwp + W_OOWP * teamOowp;
    rows.push({ team_id: teamId, rpi, wp: teamWp, owp: teamOwp, oowp: teamOowp, w, l, t, gp: gs.length });
  }

  return rows.sort(
    (a, b) => b.rpi - a.rpi || b.wp - a.wp || a.team_id.localeCompare(b.team_id),
  );
}

// Stat math dispatch. Reads sport from league config, delegates to
// softball.ts or baseball.ts. Wired up in Phase 3.

export type Sport = "softball" | "baseball";

export type LeagueStatsConfig = {
  sport: Sport;
};

// Placeholder dispatcher — real implementation lands in Phase 3.
export async function recalcLeague(_leagueId: string): Promise<void> {
  throw new Error("recalcLeague not implemented yet (Phase 3)");
}

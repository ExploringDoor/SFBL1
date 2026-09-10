// Runs GameSlate's scheduling engine behind the platform's Build Schedule
// screen, for the leagues that opt in (flags.gameslate_scheduler).
//
// Why an adapter and not a merge: lib/schedule-generator.ts is what every
// other league builds its season with, and it is not touched. This file takes
// the same inputs the screen already gathers, adds the rules only the
// GameSlate engine understands (lib/gameslate/rules.ts), and hands back a
// result in the shape the screen already renders — so the preview, the
// drafts, the host-choice picker and the Create button have one code path
// whichever engine built the games.
//
// Pure, like both engines. Same inputs and seed, same schedule.

import type { ConflictGame } from "@/lib/schedule-conflicts";
import type {
  GeneratorField,
  GeneratorResult,
  GeneratorTeam,
  HomeFieldChoice,
} from "@/lib/schedule-generator";
import {
  generateSchedule,
  scheduleQuality,
  type GeneratorOptions as GsOptions,
  type ScheduleQuality,
} from "./schedule-generator";
import { linkedGroups, type GameslateRules } from "./rules";

export interface GameslateBuild {
  teams: GeneratorTeam[];
  startDate: string;
  endDate?: string;
  weeks?: number;
  daysOfWeek?: number[];
  blackoutDates: string[];
  fields: GeneratorField[];
  blockedPairs: [string, string][];
  division?: string;
  gamesPerWeek: number;
  /** 0 = not targeted; the season shape comes from rules.cycles instead. */
  gamesPerTeam: number;
  weeklyPairing: "same-opponent" | "different-opponents";
  existingGames: ConflictGame[];
  rules: GameslateRules;
  /** Any integer. Same seed, same layout; the screen bumps it for "try
   *  another layout". */
  seed: number;
}

export type GameslateResult = GeneratorResult & {
  engine: "gameslate";
  quality: ScheduleQuality;
  seed: number;
};

export function buildWithGameslate(input: GameslateBuild): GameslateResult {
  const { rules } = input;
  const targeted = input.gamesPerTeam > 0;

  const opts: GsOptions = {
    teams: input.teams,
    startDate: input.startDate,
    ...(input.endDate ? { endDate: input.endDate } : {}),
    ...(input.weeks ? { weeks: input.weeks } : {}),
    ...(input.daysOfWeek && input.daysOfWeek.length ? { daysOfWeek: input.daysOfWeek } : {}),
    blackoutDates: input.blackoutDates,
    fields: input.fields,
    blockedPairs: input.blockedPairs,
    ...(input.division ? { division: input.division } : {}),
    gamesPerWeek: input.gamesPerWeek,
    weeklyPairing: input.weeklyPairing,
    existingGames: input.existingGames,
    seed: input.seed,
    // A target beats the cycle count: "8 games each" is a complete answer to
    // how long the season is, and stacking a round-robin cap on top of it
    // would only ever shorten it.
    ...(targeted
      ? { targetGamesPerTeam: input.gamesPerTeam }
      : rules.cycles > 0
        ? { maxCycles: rules.cycles }
        : {}),
    ...(rules.gameMinutes > 0 ? { gameMinutes: rules.gameMinutes } : {}),
    ...(rules.maxPerTeamPerDay > 0 ? { maxPerTeamPerDay: rules.maxPerTeamPerDay } : {}),
    doubleheaders: rules.doubleheaders,
    ...(rules.minGapMinutes > 0 ? { minGapMinutes: rules.minGapMinutes } : {}),
    ...(rules.maxGapMinutes > 0 ? { maxGapMinutes: rules.maxGapMinutes } : {}),
    ...(rules.minDaysRest > 0 ? { minDaysRest: rules.minDaysRest } : {}),
    slotPreference: rules.slotPreference,
    homeFieldRule: rules.homeFieldRule,
    ...(rules.noRematchWeeks > 0 ? { noRematchWeeks: rules.noRematchWeeks } : {}),
    ...(rules.maxConsecutive > 0
      ? { maxConsecutiveHome: rules.maxConsecutive, maxConsecutiveAway: rules.maxConsecutive }
      : {}),
    pairAlternate: rules.pairAlternate,
  };
  const groups = linkedGroups(rules.linkedPairs);
  if (groups.length > 0) opts.linkedTeamIds = groups;

  const res = generateSchedule(opts);

  // ---- back into the platform's result shape -----------------------------
  const nameOf = new Map(input.teams.map((t) => [t.id, t.name]));
  const name = (id: string) => nameOf.get(id) ?? id;

  const placed = new Map<string, number>();
  const pairCount = new Map<string, number>();
  for (const g of res.games) {
    placed.set(g.home_team_id, (placed.get(g.home_team_id) ?? 0) + 1);
    placed.set(g.away_team_id, (placed.get(g.away_team_id) ?? 0) + 1);
    const key = [g.home_team_id, g.away_team_id].sort().join("|");
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }
  const gamesPerTeamActual = input.teams
    .map((t) => ({ team: t.name, games: placed.get(t.id) ?? 0 }))
    .sort((a, b) => a.games - b.games || (a.team < b.team ? -1 : 1));

  // A pair meeting twice is only news when the season was not meant to
  // cycle: in fill mode repeats are the whole idea.
  const repeatMatchups: { a: string; b: string }[] =
    targeted || rules.cycles === 1
      ? [...pairCount.entries()]
          .filter(([, n]) => n > 1)
          .map(([key]) => {
            const [a, b] = key.split("|") as [string, string];
            return { a: name(a), b: name(b) };
          })
      : [];

  // Both teams have a home venue, so somebody travels. The engine picked;
  // the screen lets the admin pick differently. Same contract as the
  // platform engine's own list.
  const homeOf = new Map(
    input.teams.map((t) => [t.id, String(t.homeField ?? "").trim()]),
  );
  const homeFieldChoices: HomeFieldChoice[] = [];
  res.games.forEach((g, i) => {
    const aField = homeOf.get(g.away_team_id) ?? "";
    const bField = homeOf.get(g.home_team_id) ?? "";
    if (!aField || !bField || aField === bField) return;
    homeFieldChoices.push({
      game: i,
      date: g.date,
      time: g.time,
      a: g.away_team_id,
      b: g.home_team_id,
      aName: name(g.away_team_id),
      bName: name(g.home_team_id),
      aField,
      bField,
      chosen: g.field,
    });
  });

  const quality = scheduleQuality(
    res.games,
    res.unscheduled.length + res.noLegalField.length,
  );

  return {
    engine: "gameslate",
    seed: input.seed,
    quality,
    games: res.games.map((g) => ({
      date: g.date,
      time: g.time,
      field: g.field,
      away_team_id: g.away_team_id,
      home_team_id: g.home_team_id,
      ...(g.division ? { division: g.division } : {}),
      week: g.week,
      status: "scheduled" as const,
    })),
    dates: res.dates,
    skippedSameOrg: res.skippedSameOrg,
    skippedBlocked: res.skippedBlocked,
    unscheduled: res.unscheduled,
    noLegalField: res.noLegalField,
    slotsBlockedByExisting: res.slotsBlockedByExisting,
    everyPairPlayed: res.everyPairPlayed,
    gamesPerTeamActual,
    extraGameTeams: [],
    repeatMatchups,
    sameOrgUsed: [],
    homeFieldChoices,
    warnings: res.warnings,
  };
}

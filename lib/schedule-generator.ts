// Round-robin schedule generator.
//
// Mike's ask (via Adam, 2026-07-29): "tell the computer how many weeks and how
// many fields and times, and which teams not to play each other." So the inputs
// are weeks / fields / times / teams, and the output is a list of games ready to
// write straight into /leagues/<id>/games.
//
// Deliberately pure — no Firestore, no React, no Date.now(). Everything is
// derived from the arguments so the same inputs always produce the same
// schedule, which is what makes the admin preview trustworthy: what you see in
// the preview is exactly what gets written.
//
// Two rules drive the pairing:
//
//   1. Everyone plays everyone at least once. Standard circle method: fix one
//      team and rotate the rest, which yields n-1 rounds covering every pair
//      exactly once (a BYE team is added when the count is odd).
//
//   2. Teams in the same organization never play each other. Phoenix Fire runs
//      Steel / Silver / Gray / Black, Brentwood runs A / B, and Mike does not
//      want those meeting in league play. Same-org pairs are dropped rather than
//      re-paired: re-pairing would either break rule 1 for somebody else or
//      quietly give one team extra games. Dropping means those two simply have
//      no game that round, which is the honest outcome, and the caller is told
//      how many were skipped so the admin can see it.

export interface GeneratorTeam {
  id: string;
  name: string;
  /** Free-text organisation/club. Teams sharing one never play each other.
   *  Blank or missing means "no club", and those teams can play anyone. */
  organization?: string | null;
}

export interface GeneratorOptions {
  teams: GeneratorTeam[];
  /** First game date, YYYY-MM-DD. Every later week is +7 days from this. */
  startDate: string;
  /** How many weeks of games to lay out. */
  weeks: number;
  /** Field names to spread games across, e.g. ["Lasorda Field 5", "Sprofera F8"]. */
  fields: string[];
  /** Start times in 24h HH:MM, e.g. ["17:30", "19:00"]. */
  times: string[];
  /** Written onto each game so standings group correctly. */
  division?: string;
  /**
   * How many games each team plays in a week, and against whom.
   *
   *   "single"        one game a week. Island's weeknight leagues.
   *   "doubleheader"  two games a week against the SAME opponent, back to
   *                   back on one field. Island's weekend leagues run this
   *                   way (their rules set a 1hr25 doubleheader), and it is
   *                   how the Summer League schedule on USSSA is laid out.
   *   "two-opponents" two games a week against DIFFERENT opponents, i.e. two
   *                   rounds of the rotation packed into one week.
   *
   * Defaults to "single". This is an input, not a rule: how often teams meet
   * in a week is Mike's call, not the generator's.
   */
  weeklyFormat?: "single" | "doubleheader" | "two-opponents";
}

export interface GeneratedGame {
  date: string;
  time: string;
  field: string;
  away_team_id: string;
  home_team_id: string;
  division?: string;
  week: number;
  status: "scheduled";
}

export interface GeneratorResult {
  games: GeneratedGame[];
  /** Pairs skipped because both teams belong to one organisation. */
  skippedSameOrg: { a: string; b: string; organization: string }[];
  /** Pairs with no slot left (more matchups than fields x times x weeks). */
  unscheduled: { a: string; b: string }[];
  /** True once every allowed pair has been scheduled at least once. */
  everyPairPlayed: boolean;
  warnings: string[];
}

const BYE = "__bye__";

/** Circle method. Returns n-1 rounds; each round pairs every team once.
 *  With an odd count a BYE placeholder sits out one team per round. */
export function roundRobinRounds(teamIds: string[]): [string, string][][] {
  const ids = [...teamIds];
  if (ids.length < 2) return [];
  if (ids.length % 2 === 1) ids.push(BYE);

  const n = ids.length;
  const fixed = ids[0]!;
  let rotating = ids.slice(1);
  const rounds: [string, string][][] = [];

  for (let r = 0; r < n - 1; r++) {
    const round: [string, string][] = [];
    // Fixed team meets the head of the rotating list.
    round.push([fixed, rotating[0]!]);
    // Remaining teams pair from the outside in.
    for (let i = 1; i < rotating.length - i; i++) {
      round.push([rotating[i]!, rotating[rotating.length - i]!]);
    }
    rounds.push(round.filter(([a, b]) => a !== BYE && b !== BYE));
    // Rotate: last element moves to the front of the rotating group.
    rotating = [rotating[rotating.length - 1]!, ...rotating.slice(0, -1)];
  }
  return rounds;
}

/** Add days to a YYYY-MM-DD date without touching the local timezone.
 *  Parsed as UTC noon so a DST boundary can never roll the date backwards. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 12, 0, 0) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function orgOf(t: GeneratorTeam): string {
  return String(t.organization ?? "").trim().toLowerCase();
}

export function generateSchedule(opts: GeneratorOptions): GeneratorResult {
  const warnings: string[] = [];
  const teams = opts.teams.filter((t) => t && t.id);
  const byId = new Map(teams.map((t) => [t.id, t]));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;

  if (teams.length < 2) {
    return {
      games: [],
      skippedSameOrg: [],
      unscheduled: [],
      everyPairPlayed: false,
      warnings: ["Need at least two teams to build a schedule."],
    };
  }
  const slotsPerWeek = opts.fields.length * opts.times.length;
  if (slotsPerWeek === 0) {
    return {
      games: [],
      skippedSameOrg: [],
      unscheduled: [],
      everyPairPlayed: false,
      warnings: ["Add at least one field and one start time."],
    };
  }

  // ---- 1. every pair, in round-robin order -------------------------------
  const rounds = roundRobinRounds(teams.map((t) => t.id));

  // ---- 2. drop same-organisation pairings --------------------------------
  const skippedSameOrg: GeneratorResult["skippedSameOrg"] = [];
  const playable = rounds.map((round) =>
    round.filter(([a, b]) => {
      const oa = orgOf(byId.get(a)!);
      const ob = orgOf(byId.get(b)!);
      if (oa && ob && oa === ob) {
        skippedSameOrg.push({
          a: nameOf(a),
          b: nameOf(b),
          organization: byId.get(a)?.organization ?? "",
        });
        return false;
      }
      return true;
    }),
  );

  // ---- 3. lay the rounds out over the requested weeks --------------------
  // How many games a team plays in a week comes from weeklyFormat. When the
  // weeks outlast the rotation the rounds repeat, with home/away flipped on
  // each pass, which is how a league gets "play everyone twice" out of the
  // same inputs.
  const format = opts.weeklyFormat ?? "single";
  const roundsPerWeek = format === "two-opponents" ? 2 : 1;
  const gamesPerMatchup = format === "doubleheader" ? 2 : 1;

  const weeks = Math.max(1, Math.floor(opts.weeks));
  const games: GeneratedGame[] = [];
  const unscheduled: GeneratorResult["unscheduled"] = [];
  const playedPairs = new Set<string>();
  const pairKey = (a: string, b: string) => [a, b].sort().join("|");

  for (let w = 0; w < weeks; w++) {
    const date = addDays(opts.startDate, w * 7);

    // Collect this week's matchups (one round, or two for "two-opponents").
    const weekMatchups: { a: string; b: string; cycle: number }[] = [];
    for (let r = 0; r < roundsPerWeek; r++) {
      const idx = w * roundsPerWeek + r;
      const cycle = Math.floor(idx / playable.length);
      (playable[idx % playable.length] ?? []).forEach(([a, b]) =>
        weekMatchups.push({ a, b, cycle }),
      );
    }

    // Expand to games: a doubleheader is the same pairing twice.
    let slot = 0;
    for (const { a, b, cycle } of weekMatchups) {
      // Keep a doubleheader together: if the pair would straddle two fields,
      // push it to the start of the next field so both games share one field
      // at consecutive times, which is how a real doubleheader is played.
      if (
        gamesPerMatchup === 2 &&
        opts.times.length >= 2 &&
        slot % opts.times.length === opts.times.length - 1
      ) {
        slot += 1;
      }
      if (slot + gamesPerMatchup > slotsPerWeek) {
        unscheduled.push({ a: nameOf(a), b: nameOf(b) });
        continue;
      }
      for (let g = 0; g < gamesPerMatchup; g++) {
        const i = slot + g;
        // Field-major: consecutive slots share a field and step through the
        // times, so the two halves of a doubleheader land back to back.
        const time = opts.times[i % opts.times.length]!;
        const field =
          opts.fields[Math.floor(i / opts.times.length) % opts.fields.length]!;
        // Flip home/away on the second pass, and between the two halves of a
        // doubleheader so neither team is home for both.
        const flip = (cycle + g) % 2 === 1;
        const [away, home] = flip ? [b, a] : [a, b];
        games.push({
          date,
          time,
          field,
          away_team_id: away,
          home_team_id: home,
          ...(opts.division ? { division: opts.division } : {}),
          week: w + 1,
          status: "scheduled",
        });
      }
      playedPairs.add(pairKey(a, b));
      slot += gamesPerMatchup;
    }
  }

  // ---- 4. tell the admin what the inputs could not fit -------------------
  const allowedPairs = new Set<string>();
  playable.forEach((round) =>
    round.forEach(([a, b]) => allowedPairs.add(pairKey(a, b))),
  );
  const everyPairPlayed = [...allowedPairs].every((k) => playedPairs.has(k));

  const weeksForFullRotation = Math.ceil(playable.length / roundsPerWeek);
  if (weeks < weeksForFullRotation) {
    warnings.push(
      `${weeks} week${weeks === 1 ? "" : "s"} is not enough for everyone to ` +
        `play everyone once. That needs ${weeksForFullRotation} weeks at this ` +
        `format. Teams that have not met yet are listed below.`,
    );
  }
  if (unscheduled.length > 0) {
    warnings.push(
      `${unscheduled.length} matchup${unscheduled.length === 1 ? "" : "s"} had ` +
        `no slot. There are ${slotsPerWeek} slots a week ` +
        `(${opts.fields.length} field${opts.fields.length === 1 ? "" : "s"} x ` +
        `${opts.times.length} time${opts.times.length === 1 ? "" : "s"}). ` +
        `Add a field or a start time.`,
    );
  }
  if (skippedSameOrg.length > 0) {
    warnings.push(
      `${skippedSameOrg.length} matchup${skippedSameOrg.length === 1 ? "" : "s"} ` +
        `skipped because both teams are in the same organization.`,
    );
  }

  return { games, skippedSameOrg, unscheduled, everyPairPlayed, warnings };
}

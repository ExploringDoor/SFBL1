// Round-robin schedule generator.
//
// Inputs are the ones a league director actually thinks in: which teams, which
// days of the week, from when to when, which dates are off, which fields and
// what times each field runs, how many games a team plays in a week, and which
// matchups must never happen.
//
// Deliberately pure — no Firestore, no React, no clock. Everything derives from
// the arguments, so the same inputs always produce the same schedule. That is
// what makes the admin preview trustworthy: what is on screen is exactly what
// gets written.
//
// Structure:
//   1. Build the real calendar first (days of week, blackouts, end date), so a
//      "week" is a set of actual dates rather than an index. Off days and off
//      weeks fall out of this naturally instead of being special cases.
//   2. Pair the teams with the circle method, so everyone meets everyone.
//   3. Drop matchups that are blocked, by organisation or by hand.
//   4. Drop the pairings into the calendar's slots.
//
// Anything that cannot be placed is reported, never silently dropped.

export interface GeneratorTeam {
  id: string;
  name: string;
  /** Free-text organisation/club. Teams sharing one never play each other.
   *  Blank or missing means "no club", and those teams can play anyone. */
  organization?: string | null;
}

/** A field and the start times available ON THAT FIELD. Times are per field,
 *  not global: one park might run 5:30 and 7:00 while another only has 5:30,
 *  and a shared time list would invent slots that do not exist. */
export interface GeneratorField {
  name: string;
  /** Start times on this field, 24h HH:MM, e.g. ["17:30", "19:00"]. */
  times: string[];
}

export interface GeneratorOptions {
  teams: GeneratorTeam[];
  /** Season start, YYYY-MM-DD. The first game lands on or after this. */
  startDate: string;
  /** Last possible date, YYYY-MM-DD. When set it beats `weeks`. */
  endDate?: string;
  /** How many weeks of games, when no endDate is given. */
  weeks?: number;
  /**
   * Which weekdays games are played on. 0 = Sunday .. 6 = Saturday.
   * A weeknight division might be [2] (Tuesdays); a weekend division playing
   * Saturday and Sunday is [6, 0]. Defaults to the weekday of startDate.
   */
  daysOfWeek?: number[];
  /**
   * Dates with no games: holiday weekends, field closures, tournament weekends.
   * A blacked-out date is removed from the calendar, so the season stretches by
   * a week rather than losing those games.
   */
  blackoutDates?: string[];
  /** Fields, each with its own available start times. */
  fields: GeneratorField[];
  /**
   * Matchups blocked by hand, as pairs of team ids. These two never play each
   * other. Order within a pair does not matter.
   */
  blockedPairs?: [string, string][];
  /** Written onto each game so standings group correctly. */
  division?: string;
  /**
   * How many games each team plays per week. Default 1. Nothing assumes 1: a
   * weeknight division might run two, a weekend division three.
   */
  gamesPerWeek?: number;
  /**
   * When gamesPerWeek is 2+, are those against the SAME opponent (a
   * doubleheader: back to back on one field, home/away alternating) or
   * DIFFERENT opponents (that many rounds packed into the week)?
   */
  weeklyPairing?: "same-opponent" | "different-opponents";
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
  /** Dates the schedule actually uses, in order. */
  dates: string[];
  /** Pairs skipped because both teams belong to one organisation. */
  skippedSameOrg: { a: string; b: string; organization: string }[];
  /** Pairs skipped because the admin blocked that specific matchup. */
  skippedBlocked: { a: string; b: string }[];
  /** Pairs with no slot left (more matchups than the calendar can hold). */
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
    round.push([fixed, rotating[0]!]);
    for (let i = 1; i < rotating.length - i; i++) {
      round.push([rotating[i]!, rotating[rotating.length - i]!]);
    }
    rounds.push(round.filter(([a, b]) => a !== BYE && b !== BYE));
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

/** 0 = Sunday .. 6 = Saturday, for a YYYY-MM-DD date. */
export function weekdayOf(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 12, 0, 0)).getUTCDay();
}

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * The season calendar: an array of weeks, each week an array of dates.
 * A week is a 7-day window from startDate. Dates that are not on a chosen
 * weekday, are blacked out, or fall past endDate are excluded — so a fully
 * blacked-out week comes back empty and simply holds no games.
 */
export function buildCalendar(opts: {
  startDate: string;
  endDate?: string;
  weeks?: number;
  daysOfWeek?: number[];
  blackoutDates?: string[];
}): string[][] {
  const days =
    opts.daysOfWeek && opts.daysOfWeek.length > 0
      ? [...new Set(opts.daysOfWeek)].sort((a, b) => a - b)
      : [weekdayOf(opts.startDate)];
  const blackout = new Set(opts.blackoutDates ?? []);
  // Hard ceiling so a bad endDate cannot spin forever.
  const maxWeeks = opts.endDate ? 104 : Math.max(1, Math.floor(opts.weeks ?? 1));

  const calendar: string[][] = [];
  for (let w = 0; w < maxWeeks; w++) {
    const weekStart = addDays(opts.startDate, w * 7);
    if (opts.endDate && weekStart > opts.endDate) break;
    const dates: string[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(weekStart, d);
      if (opts.endDate && date > opts.endDate) continue;
      if (date < opts.startDate) continue;
      if (!days.includes(weekdayOf(date))) continue;
      if (blackout.has(date)) continue;
      dates.push(date);
    }
    calendar.push(dates);
  }
  // Trailing empty weeks add nothing.
  while (calendar.length > 0 && calendar[calendar.length - 1]!.length === 0) {
    calendar.pop();
  }
  return calendar;
}

function orgOf(t: GeneratorTeam): string {
  return String(t.organization ?? "").trim().toLowerCase();
}

export function generateSchedule(opts: GeneratorOptions): GeneratorResult {
  const warnings: string[] = [];
  const teams = opts.teams.filter((t) => t && t.id);
  const byId = new Map(teams.map((t) => [t.id, t]));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;

  const empty = (msg: string): GeneratorResult => ({
    games: [],
    dates: [],
    skippedSameOrg: [],
    skippedBlocked: [],
    unscheduled: [],
    everyPairPlayed: false,
    warnings: [msg],
  });

  if (teams.length < 2) return empty("Need at least two teams to build a schedule.");

  const validFields = opts.fields
    .map((f) => ({
      name: String(f?.name ?? "").trim(),
      times: (f?.times ?? []).map((t) => String(t).trim()).filter(Boolean),
    }))
    .filter((f) => f.name && f.times.length > 0);
  if (validFields.length === 0) {
    return empty("Add at least one field with at least one start time.");
  }

  // ---- 1. the calendar ---------------------------------------------------
  const calendar = buildCalendar(opts);
  const usableWeeks = calendar.filter((w) => w.length > 0).length;
  if (usableWeeks === 0) {
    return empty(
      "No playable dates. Check the start and end dates, the days of the week, and the off dates.",
    );
  }

  // ---- 2. every pair, in round-robin order -------------------------------
  const rounds = roundRobinRounds(teams.map((t) => t.id));

  // ---- 3. drop blocked and same-organisation pairings --------------------
  const skippedSameOrg: GeneratorResult["skippedSameOrg"] = [];
  const skippedBlocked: GeneratorResult["skippedBlocked"] = [];
  const blocked = new Set(
    (opts.blockedPairs ?? [])
      .filter((p) => Array.isArray(p) && p[0] && p[1])
      .map(([a, b]) => [a, b].sort().join("|")),
  );
  const playable = rounds.map((round) =>
    round.filter(([a, b]) => {
      if (blocked.has([a, b].sort().join("|"))) {
        skippedBlocked.push({ a: nameOf(a), b: nameOf(b) });
        return false;
      }
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

  // ---- 4. drop the pairings into the calendar ----------------------------
  const gamesPerWeek = Math.max(1, Math.floor(opts.gamesPerWeek ?? 1));
  const sameOpponent = (opts.weeklyPairing ?? "same-opponent") === "same-opponent";
  const roundsPerWeek = sameOpponent ? 1 : gamesPerWeek;
  const gamesPerMatchup = sameOpponent ? gamesPerWeek : 1;

  const games: GeneratedGame[] = [];
  const unscheduled: GeneratorResult["unscheduled"] = [];
  const playedPairs = new Set<string>();
  const pairKey = (a: string, b: string) => [a, b].sort().join("|");
  const usedDates: string[] = [];

  let roundCursor = 0;
  let weekNo = 0;

  for (const weekDates of calendar) {
    if (weekDates.length === 0) continue; // an off week
    weekNo += 1;
    weekDates.forEach((d) => usedDates.push(d));

    // Slots for this week, grouped into "runs" — one run per date+field, its
    // times in order. A run is the unit a same-opponent block has to fit
    // inside, since a doubleheader is played on one field back to back.
    const runs: { date: string; field: string; time: string }[][] = [];
    for (const date of weekDates) {
      for (const f of validFields) {
        runs.push(f.times.map((time) => ({ date, field: f.name, time })));
      }
    }
    // Next free index within each run.
    const used = runs.map(() => 0);
    // Round-robin across runs rather than filling one field before touching
    // the next. Without this a Saturday/Sunday division stacked every game on
    // Saturday, and a two-field night left the second field empty.
    let runCursor = 0;
    const takeSlots = (n: number) => {
      // A block of 2+ has to come from ONE run (same date, same field,
      // consecutive times). A single game can come from anywhere.
      for (let tried = 0; tried < runs.length; tried++) {
        const r = (runCursor + tried) % runs.length;
        if (runs[r]!.length - used[r]! >= n) {
          const out = runs[r]!.slice(used[r]!, used[r]! + n);
          used[r] = used[r]! + n;
          runCursor = (r + 1) % runs.length;
          return out;
        }
      }
      return null;
    };

    // This week's matchups.
    const weekMatchups: { a: string; b: string; cycle: number }[] = [];
    for (let r = 0; r < roundsPerWeek; r++) {
      const idx = roundCursor + r;
      const cycle = Math.floor(idx / playable.length);
      (playable[idx % playable.length] ?? []).forEach(([a, b]) =>
        weekMatchups.push({ a, b, cycle }),
      );
    }
    roundCursor += roundsPerWeek;

    for (const { a, b, cycle } of weekMatchups) {
      const picked = takeSlots(gamesPerMatchup);
      if (!picked) {
        unscheduled.push({ a: nameOf(a), b: nameOf(b) });
        continue;
      }
      for (let g = 0; g < gamesPerMatchup; g++) {
        const s = picked[g]!;
        // Flip home/away on later passes, and between halves of a
        // doubleheader, so neither side is home twice.
        const flip = (cycle + g) % 2 === 1;
        const [away, home] = flip ? [b, a] : [a, b];
        games.push({
          date: s.date,
          time: s.time,
          field: s.field,
          away_team_id: away,
          home_team_id: home,
          ...(opts.division ? { division: opts.division } : {}),
          week: weekNo,
          status: "scheduled",
        });
      }
      playedPairs.add(pairKey(a, b));
    }
  }

  // ---- 5. report what the inputs could not fit ---------------------------
  const allowedPairs = new Set<string>();
  playable.forEach((round) =>
    round.forEach(([a, b]) => allowedPairs.add(pairKey(a, b))),
  );
  const everyPairPlayed = [...allowedPairs].every((k) => playedPairs.has(k));

  const weeksForFullRotation = Math.ceil(playable.length / roundsPerWeek);
  if (usableWeeks < weeksForFullRotation) {
    warnings.push(
      `${usableWeeks} playable week${usableWeeks === 1 ? "" : "s"} is not enough ` +
        `for everyone to play everyone once. That needs ${weeksForFullRotation} ` +
        `at this format. Extend the end date, or add game days.`,
    );
  }
  if (unscheduled.length > 0) {
    warnings.push(
      `${unscheduled.length} matchup${unscheduled.length === 1 ? "" : "s"} had no ` +
        `slot. Add a field, another start time, or another day of the week.`,
    );
  }
  if (skippedSameOrg.length > 0) {
    warnings.push(
      `${skippedSameOrg.length} matchup${skippedSameOrg.length === 1 ? "" : "s"} ` +
        `skipped because both teams are in the same organization.`,
    );
  }
  if (skippedBlocked.length > 0) {
    warnings.push(
      `${skippedBlocked.length} matchup${skippedBlocked.length === 1 ? "" : "s"} ` +
        `skipped because you blocked those teams from playing each other.`,
    );
  }

  return {
    games,
    dates: usedDates,
    skippedSameOrg,
    skippedBlocked,
    unscheduled,
    everyPairPlayed,
    warnings,
  };
}

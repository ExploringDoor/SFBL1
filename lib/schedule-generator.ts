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

import {
  legalFieldsFor,
  minutesOf,
  type ConflictGame,
  type ConflictTeam,
} from "./schedule-conflicts";

export interface GeneratorTeam {
  id: string;
  name: string;
  /** Free-text organisation/club. Teams sharing one never play each other.
   *  Blank or missing means "no club", and those teams can play anyone. */
  organization?: string | null;
  /** Dates this team cannot play, YYYY-MM-DD. Distinct from the league-wide
   *  off days: "Riverhead is away the weekend of the 20th" only blocks that
   *  team, and the rest of the division plays as normal. */
  unavailable?: string[];
  /** This team's home field. Games are nudged towards it, and the team is
   *  made the home side when a game lands there. Ties into a home-field
   *  discount, where a club is expected to host a share of its games. */
  homeField?: string | null;
  /**
   * Fields this team may play at AT ALL. Distinct from `homeField`, which is a
   * preference worth a scoring nudge: this is a hard wall. A 14U squad that
   * needs a full-size diamond, or a club with permits for only its own park,
   * cannot simply be "nudged" elsewhere.
   *
   * Empty or missing means unrestricted, which is the right default — most
   * teams travel, and requiring every team to be configured before a schedule
   * can be built would make the feature unusable at 185 teams.
   */
  allowedFields?: string[] | null;
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
  /**
   * Games that already exist — other divisions generated earlier, hand-added
   * rows, last week's fixtures. Their date+field+time slots are treated as
   * taken, and their teams as busy at those times.
   *
   * Without this, generating division by division silently double-books: the
   * 12U run has no idea the 10U run already took Cedar Hill at 5:30. That is
   * the single most common way a multi-division league's schedule breaks.
   */
  existingGames?: ConflictGame[];
  /**
   * How long a game occupies its field, in minutes. 0 (default) means a slot
   * is only "taken" by an exact same-start game. Set it and near-misses like
   * 17:30 against 18:00 on one field stop being scheduled.
   */
  gameMinutes?: number;
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
  /** Pairs whose teams' allowed-field sets do not overlap, so no field in the
   *  league can legally host them. A configuration problem, not a capacity
   *  one — worth telling the admin apart from `unscheduled`. */
  noLegalField: { a: string; b: string }[];
  /** Slots skipped because an existing game already occupies them. Counted so
   *  the admin can see the generator worked around the rest of the league
   *  rather than wondering why it produced fewer games than expected. */
  slotsBlockedByExisting: number;
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
    noLegalField: [],
    slotsBlockedByExisting: 0,
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
  const noLegalField: GeneratorResult["noLegalField"] = [];
  const noLegalFieldSeen = new Set<string>();
  const playedPairs = new Set<string>();
  const pairKey = (a: string, b: string) => [a, b].sort().join("|");
  const usedDates: string[] = [];
  let slotsBlockedByExisting = 0;

  // ---- what the rest of the league has already taken ---------------------
  // Existing games make two things unavailable: the field slot itself, and the
  // teams playing in it. Both are indexed up front so the placement loop below
  // stays a cheap lookup rather than a scan per candidate slot.
  const gameMinutes = Math.max(0, Math.floor(opts.gameMinutes ?? 0));
  const normField = (f: string | null | undefined) =>
    String(f ?? "").trim().toLowerCase().replace(/\s+/g, " ");

  // date|field -> start times in minutes that are occupied
  const busyField = new Map<string, number[]>();
  // date|teamId -> start times in minutes that team is already committed to
  const busyTeam = new Map<string, number[]>();
  for (const eg of opts.existingGames ?? []) {
    const mins = minutesOf(eg.time);
    if (mins === null) continue; // no time to compare against
    const f = normField(eg.field);
    if (f) {
      const key = `${eg.date}|${f}`;
      const list = busyField.get(key);
      if (list) list.push(mins);
      else busyField.set(key, [mins]);
    }
    for (const tid of [eg.away_team_id, eg.home_team_id]) {
      if (!tid) continue;
      const key = `${eg.date}|${tid}`;
      const list = busyTeam.get(key);
      if (list) list.push(mins);
      else busyTeam.set(key, [mins]);
    }
  }

  /** Does a candidate start time collide with anything already booked? Same
   *  overlap rule the conflict checker uses, so the generator can never emit a
   *  schedule that findConflicts would then reject. */
  const collides = (taken: number[] | undefined, start: number) => {
    if (!taken) return false;
    if (gameMinutes <= 0) return taken.includes(start);
    return taken.some((t) => start < t + gameMinutes && t < start + gameMinutes);
  };

  const slotTaken = (date: string, field: string, time: string) => {
    const mins = minutesOf(time);
    if (mins === null) return false;
    return collides(busyField.get(`${date}|${normField(field)}`), mins);
  };

  const teamBusy = (teamId: string, date: string, time: string) => {
    const mins = minutesOf(time);
    if (mins === null) return false;
    return collides(busyTeam.get(`${date}|${teamId}`), mins);
  };

  /** Record a placement so later matchups in this same run see it too. */
  const markTaken = (date: string, field: string, time: string, a: string, b: string) => {
    const mins = minutesOf(time);
    if (mins === null) return;
    const fk = `${date}|${normField(field)}`;
    busyField.set(fk, [...(busyField.get(fk) ?? []), mins]);
    for (const tid of [a, b]) {
      const tk = `${date}|${tid}`;
      busyTeam.set(tk, [...(busyTeam.get(tk) ?? []), mins]);
    }
  };

  // Fields a given matchup is allowed to use at all, cached per pair.
  const asConflictTeam = (id: string): ConflictTeam | undefined => {
    const t = byId.get(id);
    return t ? { id: t.id, name: t.name, allowedFields: t.allowedFields } : undefined;
  };
  const legalFieldCache = new Map<string, Set<string> | null>();
  const legalFieldsSet = (a: string, b: string): Set<string> | null => {
    const key = pairKey(a, b);
    if (legalFieldCache.has(key)) return legalFieldCache.get(key)!;
    const allowed = legalFieldsFor(
      asConflictTeam(a),
      asConflictTeam(b),
      validFields.map((f) => f.name),
    );
    // null means "no restriction", which is not the same as "no legal field".
    const unrestricted =
      (byId.get(a)?.allowedFields ?? []).length === 0 &&
      (byId.get(b)?.allowedFields ?? []).length === 0;
    const set = unrestricted ? null : new Set(allowed.map(normField));
    legalFieldCache.set(key, set);
    return set;
  };

  // Running fairness counters. These are what stop one team being home seven
  // times out of ten, or always drawing the 9am slot.
  const homeCount = new Map<string, number>();
  const timeCount = new Map<string, Map<string, number>>(); // team -> time -> n
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const timesFor = (id: string) => {
    let m = timeCount.get(id);
    if (!m) timeCount.set(id, (m = new Map()));
    return m;
  };
  const unavailableOn = (id: string, date: string) =>
    (byId.get(id)?.unavailable ?? []).includes(date);
  const homeFieldOf = (id: string) => String(byId.get(id)?.homeField ?? "").trim();

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
    // Which slots are still free, per run, and how many games each run has
    // taken — used to spread across days and fields rather than filling one
    // first. Tracked slot by slot rather than as a "next free index": a single
    // game must be able to take the LATE slot while the early one is still
    // open, otherwise a team can never be moved off the 9am it always draws.
    const free = runs.map((r) => r.map(() => true));
    const load = runs.map(() => 0);

    /**
     * Choose the best free slots for one matchup, rather than taking the next
     * in line. Lower score wins. This is where fairness lives:
     *
     *   - a team never plays on a date it said it is unavailable (hard block)
     *   - the slot time each team has had least is preferred, so nobody owns
     *     the 9am game all season
     *   - a team's home field pulls its games towards that field
     *   - lightly-loaded runs are preferred, which keeps the spread across
     *     days and fields that the round-robin cursor used to give
     */
    const takeSlots = (n: number, a: string, b: string) => {
      const legal = legalFieldsSet(a, b);
      let best: { r: number; i: number; score: number } | null = null;
      for (let r = 0; r < runs.length; r++) {
        // Every start position whose next n slots are all still free. For a
        // single game that is any free slot; for a block it must be n in a row
        // on the one field, which is what a doubleheader is.
        for (let i = 0; i + n <= runs[r]!.length; i++) {
          let ok = true;
          for (let k = 0; k < n; k++) if (!free[r]![i + k]) { ok = false; break; }
          if (!ok) continue;
          const window = runs[r]!.slice(i, i + n);
          // Hard block: either team unavailable on that date.
          if (
            window.some((s) => unavailableOn(a, s.date) || unavailableOn(b, s.date))
          ) {
            continue;
          }
          // Hard block: this field is not one both teams may use.
          if (legal && window.some((s) => !legal.has(normField(s.field)))) continue;
          // Hard block: the slot, or one of these teams, is already committed
          // elsewhere in the league. This is what stops division-by-division
          // generation from stacking games onto one field.
          if (
            window.some(
              (s) =>
                slotTaken(s.date, s.field, s.time) ||
                teamBusy(a, s.date, s.time) ||
                teamBusy(b, s.date, s.time),
            )
          ) {
            slotsBlockedByExisting += 1;
            continue;
          }
          let score = load[r]! * 2; // spread across days and fields
          for (const s of window) {
            score += (timesFor(a).get(s.time) ?? 0) + (timesFor(b).get(s.time) ?? 0);
            if (homeFieldOf(a) === s.field || homeFieldOf(b) === s.field) score -= 3;
          }
          if (best === null || score < best.score) best = { r, i, score };
        }
      }
      if (best === null) return null;
      const { r, i } = best;
      for (let k = 0; k < n; k++) free[r]![i + k] = false;
      load[r] = load[r]! + 1;
      const picked = runs[r]!.slice(i, i + n);
      // Feed the placement back into the busy index so the next matchup in this
      // same run sees it, exactly as it would see a pre-existing game.
      picked.forEach((s) => markTaken(s.date, s.field, s.time, a, b));
      return picked;
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

    for (const { a, b } of weekMatchups) {
      // A pairing whose allowed-field sets do not intersect can never be placed,
      // no matter how much calendar is added. Report it as its own problem —
      // telling an admin to "add a field or another start time" when the real
      // fix is a team's eligibility list would send them the wrong way.
      const legal = legalFieldsSet(a, b);
      if (legal && legal.size === 0) {
        const key = pairKey(a, b);
        if (!noLegalFieldSeen.has(key)) {
          noLegalFieldSeen.add(key);
          noLegalField.push({ a: nameOf(a), b: nameOf(b) });
        }
        continue;
      }
      const picked = takeSlots(gamesPerMatchup, a, b);
      if (!picked) {
        unscheduled.push({ a: nameOf(a), b: nameOf(b) });
        continue;
      }
      for (let g = 0; g < gamesPerMatchup; g++) {
        const s = picked[g]!;
        // Who is home. Priority:
        //   1. whoever's home field this is
        //   2. otherwise whoever has been home less so far, which is what
        //      keeps the season from ending 7 home / 3 away
        //   3. within a doubleheader, alternate so neither hosts both
        let home: string;
        let away: string;
        const aHome = homeFieldOf(a) === s.field;
        const bHome = homeFieldOf(b) === s.field;
        if (aHome !== bHome) {
          [home, away] = aHome ? [a, b] : [b, a];
        } else if (g % 2 === 1) {
          // second half of a block: flip whatever the first half did
          const prev = games[games.length - 1]!;
          [home, away] = [prev.away_team_id, prev.home_team_id];
        } else {
          const ha = homeCount.get(a) ?? 0;
          const hb = homeCount.get(b) ?? 0;
          [home, away] = ha <= hb ? [a, b] : [b, a];
        }
        bump(homeCount, home);
        bump(timesFor(a), s.time);
        bump(timesFor(b), s.time);
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

  if (noLegalField.length > 0) {
    warnings.push(
      `${noLegalField.length} matchup${noLegalField.length === 1 ? "" : "s"} ` +
        `could not be placed because the two teams share no field they are both ` +
        `allowed to use. Widen one of their allowed-field lists.`,
    );
  }
  if (slotsBlockedByExisting > 0) {
    warnings.push(
      `${slotsBlockedByExisting} slot${slotsBlockedByExisting === 1 ? "" : "s"} ` +
        `were already taken by games elsewhere in the league and were worked ` +
        `around, so nothing here double-books an existing game.`,
    );
  }

  return {
    games,
    dates: usedDates,
    skippedSameOrg,
    skippedBlocked,
    unscheduled,
    noLegalField,
    slotsBlockedByExisting,
    everyPairPlayed,
    warnings,
  };
}

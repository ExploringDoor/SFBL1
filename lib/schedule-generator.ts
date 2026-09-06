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
   * Games each team should play. When set, THIS drives the season instead of a
   * full round robin: pairs are chosen to hit the target while avoiding repeat
   * opponents and same-club matchups, and the calendar only has to be big
   * enough to hold them. Leave unset for the old everyone-plays-everyone
   * behaviour, which is what every league using this before 2026-09-04 gets.
   */
  gamesPerTeam?: number;
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

/** A game whose two teams both have a home field. */
export interface HomeFieldChoice {
  /** Index into `games`, so the admin UI can rewrite exactly this fixture. */
  game: number;
  date: string;
  time: string;
  /** Team ids and names, in no particular order. */
  a: string;
  b: string;
  aName: string;
  bName: string;
  aField: string;
  bField: string;
  /** The field the generator went with, always one of the two. */
  chosen: string;
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
  /** True once every allowed pair has been scheduled at least once. Only
   *  meaningful in round-robin mode; a games-per-team season is not trying to
   *  cover every pair and reports `gamesPerTeamActual` instead. */
  everyPairPlayed: boolean;
  /** Games each team ended up with. The headline number in targeted mode, and
   *  the thing an admin checks first. */
  gamesPerTeamActual: { team: string; games: number }[];
  /** Teams handed the extra game because the total could not divide evenly. */
  extraGameTeams: string[];
  /** Pairs that had to meet twice to fill the card. Empty is the good case. */
  repeatMatchups: { a: string; b: string }[];
  /** Same-club pairs used anyway, because avoiding them would have left a team
   *  short. The old code deleted these games; leaving a team with fewer games
   *  was the worse outcome. */
  sameOrgUsed: { a: string; b: string }[];
  /**
   * Games where BOTH teams have a home field, so somebody has to travel.
   *
   * Mike, 2026-09-06: "if a team has a home field it will automatically put
   * them there. But if it's playing a team that also has a field then it will
   * notify me to choose." One home field is an answer; two is a question, and
   * the generator is not the one who should be answering it. It still picks a
   * field so the preview is a complete schedule, and lists the game here so
   * the choice can be taken back.
   */
  homeFieldChoices: HomeFieldChoice[];
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

// ── pairing to a games-per-team target ───────────────────────────────────
//
// The circle method above answers "how do we get everyone to play everyone".
// That is the wrong question for a fall season built out of clubs. Mike,
// 2026-09-04: "Get rid of the code that says every team must play each other
// once. The goal is to just not have teams play repeat teams or teams in their
// same organizations if we can help it."
//
// The bug underneath the request: same-club matchups used to be DELETED from
// the round-robin, so those teams simply played fewer games than everyone else.
// Deleting a fixture is not the same as avoiding it. Here a conflict causes a
// RE-PAIR, so the count per team holds.
//
// THREE RULES, in strict order of authority:
//   1. a hand-blocked pair NEVER happens. The admin said never, so never.
//   2. two teams from one club is the next thing avoided, and yields only to
//      keep a team from falling short. It used to be banned outright, so it
//      stays the least acceptable of the soft conflicts. "If we can help it"
//      are the operative words: a strong preference, not the old ban.
//   3. a repeat opponent is avoided too, but gives way BEFORE a club derby
//      does. A rematch is ordinary pool play; a derby is the thing directors
//      complain about.
//
// UNEVEN COUNTS. Games take two teams, so an odd number of team-slots cannot
// come out even, and exactly one team ends up playing one extra. That is
// deliberate and reported, not an accident to be hidden.

export interface TargetedRoundsOptions {
  teamIds: string[];
  /** Games each team should end up with. */
  gamesPerTeam: number;
  /** Pairs that must never be drawn, as `pairKeyOf` strings. */
  blocked?: Set<string>;
  /** Club for a team, "" for none. Teams sharing one are avoided, not banned. */
  orgOf?: (id: string) => string;
}

export interface TargetedRoundsResult {
  /** Rounds, each pairing a team at most once, in playing order. */
  rounds: [string, string][][];
  /** How many games each team actually got. */
  gamesFor: Map<string, number>;
  /** Pairs that had to meet more than once to fill the card. */
  repeats: [string, string][];
  /** Same-club pairs that had to be used anyway. */
  sameOrg: [string, string][];
  /** Teams that could not reach the target at all, usually over-blocked. */
  short: string[];
}

export function pairKeyOf(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function buildTargetedRoundsOnce(
  opts: TargetedRoundsOptions,
  /** Team order to start from. Changing it changes nothing about the rules,
   *  only which of several equally legal schedules greedy finds. */
  seedOrder: (ids: string[]) => string[],
): TargetedRoundsResult {
  const ids = seedOrder([...new Set(opts.teamIds.filter(Boolean))]);
  const target = Math.max(0, Math.floor(opts.gamesPerTeam));
  const blocked = opts.blocked ?? new Set<string>();
  const orgOf = opts.orgOf ?? (() => "");

  const gamesFor = new Map<string, number>(ids.map((id) => [id, 0]));
  const metCount = new Map<string, number>();
  const rounds: [string, string][][] = [];
  const repeats: [string, string][] = [];
  const sameOrg: [string, string][] = [];
  const short: string[] = [];

  if (ids.length < 2 || target < 1) {
    return { rounds, gamesFor, repeats, sameOrg, short };
  }

  const met = (a: string, b: string) => metCount.get(pairKeyOf(a, b)) ?? 0;
  const shareClub = (a: string, b: string) => {
    const oa = orgOf(a).trim().toLowerCase();
    const ob = orgOf(b).trim().toLowerCase();
    return !!oa && oa === ob;
  };

  // Lower is better, and the weights are far enough apart that the ordering is
  // strict rather than a blend: no number of rematches ever outweighs one
  // club derby, and neither is affected by the games-played tiebreak.
  //
  // CLUB BEATS REPEAT, and that is the deliberate call. Until today a same-club
  // pair was BANNED outright, so a club derby is the thing this league has
  // always treated as unacceptable; a rematch is ordinary pool play. Loosening
  // the ban to "if we can help it" should not quietly promote the derby to
  // being the preferred way out of a tight card.
  const cost = (a: string, b: string) =>
    (shareClub(a, b) ? 1_000_000 : 0) +
    met(a, b) * 1_000 +
    (gamesFor.get(b) ?? 0);

  // Safety valve. Every round must place at least one game or the loop stops,
  // but cap the count too so a pathological block list cannot spin.
  const maxRounds = target * ids.length + ids.length + 8;

  for (let guard = 0; guard < maxRounds; guard++) {
    const needy = ids
      .filter((id) => (gamesFor.get(id) ?? 0) < target)
      // Furthest behind first, then by id so a rebuild of the same season
      // produces the same schedule.
      .sort(
        (x, y) =>
          (gamesFor.get(x) ?? 0) - (gamesFor.get(y) ?? 0) || (x < y ? -1 : 1),
      );
    if (needy.length === 0) break;

    const round: [string, string][] = [];
    const used = new Set<string>();

    for (const a of needy) {
      if (used.has(a)) continue;

      const pick = (pool: string[]) => {
        let best: string | null = null;
        let bestCost = Infinity;
        for (const b of pool) {
          if (b === a || used.has(b)) continue;
          if (blocked.has(pairKeyOf(a, b))) continue;
          const c = cost(a, b);
          if (c < bestCost) {
            bestCost = c;
            best = b;
          }
        }
        return best;
      };

      // ONLY pair two teams that both still need games. Borrowing a finished
      // team happens once, below, and deliberately NOT here: an odd number of
      // needy teams is normal in most rounds, and borrowing every time one was
      // left over handed the extra game to a different team each round. Teams
      // finished two and three games above the target.
      //
      // Leaving the odd team out costs nothing. Outstanding need falls by
      // exactly two per game, so it stays even when it started even and can
      // never strand a lone team; when it started odd it ends at exactly one,
      // which is the single extra game and the only time a borrow is right.
      const b = pick(needy);
      if (!b) continue; // no legal partner this round; a later round may differ

      used.add(a);
      used.add(b);
      round.push([a, b]);
    }

    // ── rescue ───────────────────────────────────────────────────────────
    // Teams that found no legal partner this round. Usually there is at most
    // one, and it simply waits. But two teams BLOCKED AGAINST EACH OTHER
    // strand one another every round from here on, and both then have to
    // borrow, so two teams finish with the extra game instead of one.
    //
    // They can nearly always be rescued by re-cutting a game already in this
    // round: break (x, y) into (a, x) and (b, y). Same teams, one more game,
    // two fewer stranded.
    const leftover = needy.filter((id) => !used.has(id));
    if (leftover.length >= 2 && round.length > 0) {
      const legal = (x: string, y: string) => !blocked.has(pairKeyOf(x, y));
      for (let i = 0; i < round.length && leftover.length >= 2; i++) {
        const [x, y] = round[i]!;
        const a = leftover[0]!;
        const b = leftover[1]!;
        if (legal(a, x) && legal(b, y)) {
          round[i] = [a, x];
          round.push([b, y]);
        } else if (legal(a, y) && legal(b, x)) {
          round[i] = [a, y];
          round.push([b, x]);
        } else {
          continue;
        }
        leftover.splice(0, 2);
      }
    }

    // Nothing could be paired needy-to-needy. Either one team is left needing a
    // game (the odd total, and the expected case) or the survivors are blocked
    // against each other. This is the ONE place a finished team is borrowed,
    // and it is what hands out the single extra game.
    if (round.length === 0) {
      const a = needy[0]!;
      let best: string | null = null;
      let bestCost = Infinity;
      for (const b of ids) {
        if (b === a) continue;
        // Never take someone already carrying the extra: that is how a team
        // reached target + 2.
        if ((gamesFor.get(b) ?? 0) > target) continue;
        if (blocked.has(pairKeyOf(a, b))) continue;
        const c = cost(a, b);
        if (c < bestCost) {
          bestCost = c;
          best = b;
        }
      }
      if (!best) break; // genuinely unpairable; reported as short below
      round.push([a, best]);
    }

    // ── repair pass ──────────────────────────────────────────────────────
    // Taking the cheapest partner for each team in turn is greedy, and greedy
    // leaves money on the table: with four clubs of two, it would pair three
    // rounds perfectly and then have no choice but to draw a club against
    // itself, even though a different arrangement of the SAME teams had no
    // derby in it at all.
    //
    // So swap the ends of two games whenever that costs less. Cheap (the round
    // is at most half the division) and it clears exactly the case above,
    // because a same-club pair almost always has a swap that dissolves it.
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < round.length; i++) {
        for (let j = i + 1; j < round.length; j++) {
          const [a, b] = round[i]!;
          const [c, d] = round[j]!;
          const now = cost(a, b) + cost(c, d);
          const legal = (x: string, y: string) => !blocked.has(pairKeyOf(x, y));
          // Both ways of re-cutting the two games.
          const swapA = legal(a, c) && legal(b, d) ? cost(a, c) + cost(b, d) : Infinity;
          const swapB = legal(a, d) && legal(b, c) ? cost(a, d) + cost(b, c) : Infinity;
          if (swapA < now && swapA <= swapB) {
            round[i] = [a, c];
            round[j] = [b, d];
            improved = true;
          } else if (swapB < now) {
            round[i] = [a, d];
            round[j] = [b, c];
            improved = true;
          }
        }
      }
    }

    // Bookkeeping happens AFTER the repair, so the counters describe the round
    // that is actually played rather than the one greedy first proposed.
    for (const [a, b] of round) {
      if (met(a, b) > 0) repeats.push([a, b]);
      if (shareClub(a, b)) sameOrg.push([a, b]);
      metCount.set(pairKeyOf(a, b), met(a, b) + 1);
      gamesFor.set(a, (gamesFor.get(a) ?? 0) + 1);
      gamesFor.set(b, (gamesFor.get(b) ?? 0) + 1);
    }
    rounds.push(round);
  }

  for (const id of ids) {
    if ((gamesFor.get(id) ?? 0) < target) short.push(id);
  }
  return { rounds, gamesFor, repeats, sameOrg, short };
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
    gamesPerTeamActual: [],
    extraGameTeams: [],
    repeatMatchups: [],
    sameOrgUsed: [],
    homeFieldChoices: [],
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

  // ---- 2 + 3. build the matchups -----------------------------------------
  // TWO MODES. `gamesPerTeam` builds to a target, avoiding repeats and clubs
  // but re-pairing rather than deleting when they collide. Without it the old
  // round robin runs unchanged, which is what every league configured before
  // 2026-09-04 still gets.
  const skippedSameOrg: GeneratorResult["skippedSameOrg"] = [];
  const skippedBlocked: GeneratorResult["skippedBlocked"] = [];
  const blocked = new Set(
    (opts.blockedPairs ?? [])
      .filter((p) => Array.isArray(p) && p[0] && p[1])
      .map(([a, b]) => [a, b].sort().join("|")),
  );

  const gamesPerTeam = Math.max(0, Math.floor(opts.gamesPerTeam ?? 0));
  const targeted = gamesPerTeam > 0;

  let playable: [string, string][][];
  let targetedResult: TargetedRoundsResult | null = null;

  if (targeted) {
    targetedResult = buildTargetedRounds({
      teamIds: teams.map((t) => t.id),
      gamesPerTeam,
      blocked,
      orgOf: (id) => orgOf(byId.get(id)!),
    });
    playable = targetedResult.rounds;
    // A blocked pair never reaches the calendar in this mode, so there is
    // nothing to "skip" and nothing to report under that heading.
  } else {
    const rounds = roundRobinRounds(teams.map((t) => t.id));
    playable = rounds.map((round) =>
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
  }

  // ---- 4. drop the pairings into the calendar ----------------------------
  const gamesPerWeek = Math.max(1, Math.floor(opts.gamesPerWeek ?? 1));
  const sameOpponent = (opts.weeklyPairing ?? "same-opponent") === "same-opponent";
  const roundsPerWeek = sameOpponent ? 1 : gamesPerWeek;
  // In targeted mode a matchup is always ONE game. "Two games a week" there
  // means a team plays twice against two different opponents, which is the
  // whole point of avoiding repeats; a same-opponent doubleheader would be a
  // repeat by construction. gamesPerWeek still caps a team's weekly load, it
  // is just enforced on the queue below rather than by the round shape.
  const gamesPerMatchup = targeted ? 1 : sameOpponent ? gamesPerWeek : 1;

  const games: GeneratedGame[] = [];
  // Games where both sides have a home field. Filled during placement below.
  const homeFieldChoices: HomeFieldChoice[] = [];
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

  // TARGETED MODE CARRIES ITS WORK FORWARD.
  //
  // Round-robin mode treats a week as a round and drops whatever will not fit,
  // which is right there: the rotation is the point, and a missed pair is
  // reported. Here the COUNT is the point. A division whose round is twenty
  // games but whose Saturday holds twelve slots would otherwise hand eight
  // teams a game short, week after week, while the calendar sat half empty.
  //
  // So the matchups are a queue. Whatever will not fit this week is first in
  // line next week, and the season stretches instead of the promise breaking.
  let pending: [string, string][] = targeted ? playable.flat() : [];

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
      // Round-robin mode WRAPS: the rotation repeats until the calendar runs
      // out, which is how a long season keeps producing games. Targeted mode
      // must NOT wrap. Its rounds are exactly the games each team was asked
      // for, so wrapping would quietly hand everyone a second helping.
      if (targeted) break; // the queue below decides this week's card
      const cycle = Math.floor(idx / playable.length);
      (playable[idx % playable.length] ?? []).forEach(([a, b]) =>
        weekMatchups.push({ a, b, cycle }),
      );
    }
    roundCursor += roundsPerWeek;

    if (targeted) {
      // Take from the front of the queue, skipping any matchup that would give
      // a team more games this week than it is allowed. Order is preserved, so
      // the round structure still spreads opponents out; it just no longer
      // forces a whole round into one week.
      const thisWeek = new Map<string, number>();
      const rest: [string, string][] = [];
      for (const [a, b] of pending) {
        const ca = thisWeek.get(a) ?? 0;
        const cb = thisWeek.get(b) ?? 0;
        if (ca < gamesPerWeek && cb < gamesPerWeek) {
          thisWeek.set(a, ca + 1);
          thisWeek.set(b, cb + 1);
          weekMatchups.push({ a, b, cycle: 0 });
        } else {
          rest.push([a, b]);
        }
      }
      pending = rest;
      // Nothing waiting and nothing placed: the season is done.
      if (weekMatchups.length === 0) break;
    }

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
        // Round-robin mode has no later chance at this pair, so it is lost and
        // reported. Targeted mode puts it back at the head of the queue and
        // tries again next week.
        if (targeted) pending.unshift([a, b]);
        else unscheduled.push({ a: nameOf(a), b: nameOf(b) });
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
        // BOTH sides have a home field: the generator has just decided which
        // one travels, and that is a decision the league should make. Recorded
        // with the index of the fixture so the admin can flip it.
        const fa = homeFieldOf(a);
        const fb = homeFieldOf(b);
        if (fa && fb && fa !== fb) {
          homeFieldChoices.push({
            game: games.length,
            date: s.date,
            time: s.time,
            a,
            b,
            aName: nameOf(a),
            bName: nameOf(b),
            aField: fa,
            bField: fb,
            chosen: s.field,
          });
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

  // Whatever is still queued when the calendar runs out never got a slot.
  for (const [a, b] of pending) {
    unscheduled.push({ a: nameOf(a), b: nameOf(b) });
  }

  // ---- 5. report what the inputs could not fit ---------------------------
  const allowedPairs = new Set<string>();
  playable.forEach((round) =>
    round.forEach(([a, b]) => allowedPairs.add(pairKey(a, b))),
  );
  const everyPairPlayed = [...allowedPairs].every((k) => playedPairs.has(k));

  // How many games each team actually GOT, counted off the placed games rather
  // than the intended pairings. A matchup that found no slot is a team short a
  // game, and the admin has to see that here rather than infer it.
  const placedFor = new Map<string, number>(teams.map((t) => [t.id, 0]));
  for (const g of games) {
    placedFor.set(g.home_team_id, (placedFor.get(g.home_team_id) ?? 0) + 1);
    placedFor.set(g.away_team_id, (placedFor.get(g.away_team_id) ?? 0) + 1);
  }
  const gamesPerTeamActual = teams
    .map((t) => ({ team: t.name, games: placedFor.get(t.id) ?? 0 }))
    .sort((a, b) => a.games - b.games || (a.team < b.team ? -1 : 1));

  const most = Math.max(0, ...placedFor.values());
  const extraGameTeams = targeted
    ? teams.filter((t) => (placedFor.get(t.id) ?? 0) === most && most > gamesPerTeam)
        .map((t) => t.name)
    : [];
  const repeatMatchups = (targetedResult?.repeats ?? []).map(([a, b]) => ({
    a: nameOf(a),
    b: nameOf(b),
  }));
  const sameOrgUsed = (targetedResult?.sameOrg ?? []).map(([a, b]) => ({
    a: nameOf(a),
    b: nameOf(b),
  }));

  if (targeted) {
    const shortNames = teams
      .filter((t) => (placedFor.get(t.id) ?? 0) < gamesPerTeam)
      .map((t) => `${t.name} (${placedFor.get(t.id) ?? 0})`);
    if (shortNames.length > 0) {
      // Two very different causes, and the wrong advice sends an admin off to
      // add Sundays when the real problem is a block list that leaves a team
      // with nobody legal to play. `short` comes from the pairing stage, before
      // the calendar is involved, so it tells them apart exactly.
      const pairingShort = (targetedResult?.short ?? []).length > 0;
      warnings.push(
        `${shortNames.length} team${shortNames.length === 1 ? "" : "s"} did not ` +
          `reach ${gamesPerTeam} games: ${shortNames.slice(0, 6).join(", ")}` +
          `${shortNames.length > 6 ? ", …" : ""}. ` +
          (pairingShort
            ? `There were not enough legal opponents to fill their games. ` +
              `Lift a blocked matchup, or lower the games per team.`
            : `The matchups exist but the calendar could not hold them. Add ` +
              `game days, another field, or another start time, or extend the ` +
              `end date.`),
      );
    }
    if (repeatMatchups.length > 0) {
      warnings.push(
        `${repeatMatchups.length} matchup${repeatMatchups.length === 1 ? "" : "s"} ` +
          `had to be played twice to fill everyone's games. Fewer games per ` +
          `team, or more teams, would avoid it.`,
      );
    }
    if (sameOrgUsed.length > 0) {
      warnings.push(
        `${sameOrgUsed.length} game${sameOrgUsed.length === 1 ? "" : "s"} had to ` +
          `pair two teams from the same club. There was no other opponent left ` +
          `that would keep them at ${gamesPerTeam} games.`,
      );
    }
  } else {
    const weeksForFullRotation = Math.ceil(playable.length / roundsPerWeek);
    if (usableWeeks < weeksForFullRotation) {
      warnings.push(
        `${usableWeeks} playable week${usableWeeks === 1 ? "" : "s"} is not enough ` +
          `for everyone to play everyone once. That needs ${weeksForFullRotation} ` +
          `at this format. Extend the end date, or add game days.`,
      );
    }
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
    gamesPerTeamActual,
    extraGameTeams,
    repeatMatchups,
    sameOrgUsed,
    homeFieldChoices,
    everyPairPlayed,
    warnings,
  };
}

/**
 * Build the rounds, best of a few deterministic starting orders.
 *
 * Greedy plus the repair passes lands on a perfect card for all but a handful
 * of shapes (1,968 combinations of size, games, club layout and blocked pairs
 * were checked; one was imperfect). The stragglers are not a rules problem,
 * they are greedy committing early and finding no way back, so the cheapest
 * real fix is to deal the teams in a different order and keep the better
 * result. Four fixed orders, no randomness, so a rebuilt season is identical.
 *
 * Eight orders were tried and measured: no better. Where greedy still leaves a
 * rematch on the table (Island's 12U takes four where one is possible) the
 * cause is structural, not the deal, and it would need a real matching
 * algorithm. Not worth it: the count per team is still exact, no club is drawn
 * against itself, and the preview names every rematch.
 */
export function buildTargetedRounds(
  opts: TargetedRoundsOptions,
): TargetedRoundsResult {
  const target = Math.max(0, Math.floor(opts.gamesPerTeam));
  const seeds: ((ids: string[]) => string[])[] = [
    (ids) => ids,
    (ids) => [...ids].reverse(),
    // Deal the two halves alternately, which breaks up clubs that were entered
    // next to each other, and rotate by one so a different team leads.
    (ids) => {
      const half = Math.ceil(ids.length / 2);
      const out: string[] = [];
      for (let i = 0; i < half; i++) {
        out.push(ids[i]!);
        if (ids[half + i]) out.push(ids[half + i]!);
      }
      return out;
    },
    (ids) => (ids.length > 1 ? [...ids.slice(1), ids[0]!] : ids),
  ];

  // Lower is better, in the same order of authority the pairing itself uses:
  // a team left short is the worst outcome, then a club derby, then a rematch,
  // and finally handing more than one team the extra game.
  const score = (r: TargetedRoundsResult) => {
    const counts = [...r.gamesFor.values()];
    const extras = counts.filter((n) => n > target).length;
    return (
      r.short.length * 1_000_000 +
      r.sameOrg.length * 10_000 +
      r.repeats.length * 100 +
      Math.max(0, extras - 1) * 10 +
      Math.max(0, ...counts.map((n) => n - target - 1))
    );
  };

  let best: TargetedRoundsResult | null = null;
  let bestScore = Infinity;
  for (const seed of seeds) {
    const r = buildTargetedRoundsOnce(opts, seed);
    const sc = score(r);
    if (sc < bestScore) {
      bestScore = sc;
      best = r;
      if (sc === 0) break; // cannot do better than a perfect card
    }
  }
  return best!;
}

/**
 * Group teams by club, exactly the way the pairing does.
 *
 * The admin shows these as chips so the setting is visible without expanding
 * anything, and so a club showing ONE team reads as what it almost always is:
 * the same club spelled two ways on two teams, keeping nobody apart.
 *
 * It shares `shareClub`'s matching rule (trimmed, case-insensitive) on purpose.
 * A summary that grouped more loosely than the scheduler would quietly promise
 * separation the schedule was never going to deliver.
 */
export function summariseClubs(
  teams: { id: string; name: string }[],
  organizationOf: (teamId: string) => string | null | undefined,
): { label: string; teams: string[] }[] {
  const groups = new Map<string, { label: string; teams: string[] }>();
  for (const t of teams) {
    const raw = String(organizationOf(t.id) ?? "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    const g = groups.get(key);
    if (g) g.teams.push(t.name);
    // First spelling seen wins the label, so the chip shows something a human
    // typed rather than a lowercased key.
    else groups.set(key, { label: raw, teams: [t.name] });
  }
  return [...groups.values()].sort(
    (a, b) => b.teams.length - a.teams.length || (a.label < b.label ? -1 : 1),
  );
}

// ── guessing clubs from team names ───────────────────────────────────────
//
// The club field keeps a club's own teams apart, and it was empty for all 41
// of Island's teams on 2026-09-04, a week before the season. Typing it 41
// times is why. And the cost of not doing it is concrete: Phoenix Fire has
// three 14U teams, LI Rebels three, LI Heat two, Waves two, so ten of the
// sixteen teams in that age group belong to four clubs and would happily be
// drawn against their own.
//
// The names say it plainly ("Phoenix Fire 12u Black", "Phoenix Fire 12u
// Silver"), so this reads them and proposes the clubs. It is a SUGGESTION,
// reviewed before it is applied and never overwriting a name already typed:
// a wrong guess that silently separated two teams would be worse than the
// blank field, because nobody would know to look.

/** Words that identify a TEAM within a club rather than the club itself. */
const TEAM_QUALIFIERS = new Set([
  "black", "white", "blue", "red", "silver", "gold", "green", "gray", "grey",
  "navy", "orange", "purple", "teal", "maroon", "pink", "yellow",
  "elite", "premier", "select", "futures", "local", "national", "american",
  "fastpitch", "softball", "baseball", "youth", "leagues", "league", "girls",
  "travel", "academy", "club", "team",
]);

/** Reduce a team name to the club it probably belongs to. Exported for tests
 *  and for the admin's preview; `suggestClubs` is what callers want. */
export function clubNameFrom(raw: string): string {
  let s = ` ${String(raw).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()} `;
  // "LI Rebels" and "Long Island Rebels" are one club, and Island has both.
  s = s.replace(/ long island /g, " li ");
  // Age tags in either order: "14u", "u14".
  s = s.replace(/ \d{1,2} ?u /g, " ").replace(/ u ?\d{1,2} /g, " ");
  const words = s.trim().split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !TEAM_QUALIFIERS.has(w) && !/^\d+$/.test(w));
  // Everything was a qualifier ("Elite Premier"). Falling through to an empty
  // string would file every such team under one blank club, which is exactly
  // the wrong answer, so keep the original words instead.
  const base = kept.length ? kept : words;
  return base.slice(0, 2).join(" ").trim();
}

export interface ClubSuggestion {
  /** Club name to apply, capitalised from the commonest spelling seen. */
  club: string;
  /** Teams that would get it. Only ever teams with no club set. */
  teams: { id: string; name: string }[];
}

/**
 * Propose clubs for teams that have none.
 *
 * Only groups of TWO OR MORE are proposed: a club of one keeps nobody apart,
 * so suggesting it is noise. Teams that already have a club are left alone but
 * still counted towards the group, so a second team joins the spelling that is
 * already there rather than starting a rival one.
 */
export function suggestClubs(
  teams: { id: string; name: string; organization?: string | null }[],
): ClubSuggestion[] {
  const groups = new Map<
    string,
    { labels: string[]; blank: { id: string; name: string }[]; taken: string[] }
  >();
  for (const t of teams) {
    const key = clubNameFrom(t.name);
    if (!key) continue;
    const g = groups.get(key) ?? { labels: [], blank: [], taken: [] };
    const existing = String(t.organization ?? "").trim();
    if (existing) g.taken.push(existing);
    else g.blank.push({ id: t.id, name: t.name });
    g.labels.push(key);
    groups.set(key, g);
  }

  const out: ClubSuggestion[] = [];
  for (const [key, g] of groups) {
    const size = g.blank.length + g.taken.length;
    if (size < 2 || g.blank.length === 0) continue;
    // Join the spelling already in use, if there is one.
    const label =
      g.taken[0] ??
      key.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bLi\b/, "LI");
    out.push({ club: label, teams: g.blank });
  }
  return out.sort(
    (a, b) => b.teams.length - a.teams.length || (a.club < b.club ? -1 : 1),
  );
}

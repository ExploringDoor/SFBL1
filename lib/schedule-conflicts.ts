// Schedule conflict detection.
//
// The scheduling problem a multi-club league actually has is not "build a
// round robin" — lib/schedule-generator.ts already does that, and it never
// double-books a slot WITHIN one run. The problem is everything around it:
//
//   1. Divisions are generated one at a time. Run 10U Section One, then 12U
//      Section One, and the second run knows nothing about the fields the
//      first one took. At 9 divisions sharing one pool of fields, they collide
//      constantly.
//   2. Admins hand-add and hand-edit games. Those never went through the
//      generator at all.
//   3. A team can only play at certain fields (a 14U squad needs a full-size
//      diamond; a club may only have permits for its own park). The generator
//      treats `homeField` as a soft preference worth -3 in scoring, which is
//      right for "nudge games home" and wrong for "this is physically not a
//      field this team can use".
//
// So conflict detection lives here rather than inside the generator: it has to
// run over games from every source, including ones already in Firestore, and
// it has to run on save as well as on generate.
//
// Deliberately pure — no Firestore, no clock. Callers pass in the games they
// already have. That keeps it unit-testable and lets the admin UI run the same
// check client-side for a live preview that cannot disagree with the server.

/** A game to check. Shape is the intersection of what the generator emits and
 *  what the games collection stores, so both can be passed without mapping. */
export interface ConflictGame {
  /** Firestore doc id when the game already exists; absent for new ones. */
  id?: string;
  /** YYYY-MM-DD. */
  date: string;
  /** 24h HH:MM. May be empty — see `missing_time` below. */
  time?: string;
  field?: string;
  away_team_id: string;
  home_team_id: string;
  division?: string;
}

export interface ConflictTeam {
  id: string;
  name?: string;
  /**
   * Fields this team is permitted to play at. Empty or missing means "no
   * restriction" — most teams travel freely and should not need configuring.
   *
   * For a matchup, the legal fields are the INTERSECTION of both teams'
   * allowed sets, because both teams have to be able to use the field they
   * meet on. An unrestricted team contributes no constraint, so a restricted
   * team playing an unrestricted one is simply limited to its own set.
   */
  allowedFields?: string[] | null;
  /** Dates this team cannot play, YYYY-MM-DD. */
  unavailable?: string[] | null;
}

export type ConflictKind =
  /** Two games on one field at the same date and time. */
  | "field_double_booked"
  /** One team in two places at once. */
  | "team_double_booked"
  /** The field is not in a participating team's allowed set. */
  | "field_not_allowed"
  /** A team is scheduled on a date it declared unavailable. */
  | "team_unavailable"
  /** Shares a field and date with another game but has no start time, so an
   *  overlap can be neither confirmed nor ruled out. */
  | "missing_time";

/** `error` blocks a save. `warning` is surfaced but does not block, because it
 *  describes something suspicious rather than something provably wrong. */
export type ConflictSeverity = "error" | "warning";

export interface Conflict {
  kind: ConflictKind;
  severity: ConflictSeverity;
  /** Human-readable, written to be shown to a league admin as-is. */
  message: string;
  /** Indices into the `games` array passed to findConflicts. Games that came
   *  in via `existingGames` are not indexed here — see `existingIds`. */
  gameIndexes: number[];
  /** Doc ids of already-stored games involved in this conflict, when known. */
  existingIds: string[];
  date: string;
  field?: string;
  time?: string;
  teamIds: string[];
}

export interface FindConflictsOptions {
  /** Games already stored for this league — other divisions, earlier
   *  generations, hand-added rows. Checked against, never reported as the
   *  offending row, so an admin sees "your new game hits an existing one". */
  existingGames?: ConflictGame[];
  teams?: ConflictTeam[];
  /**
   * How long a game occupies its field, in minutes. 0 (the default) means only
   * an exact same-time match counts as a field collision.
   *
   * Left off by default on purpose: guessing a duration would invent conflicts
   * a league does not believe in. Set it (a youth baseball game is realistically
   * 105-120 minutes) and back-to-back slots that genuinely overlap start being
   * caught — 17:30 and 18:00 on one field is a real conflict that exact-match
   * checking misses entirely.
   */
  gameMinutes?: number;
}

/** Field names are compared case- and whitespace-insensitively, because
 *  "Cedar Hill" typed into one form and "cedar hill " into another are the
 *  same patch of grass and must collide. */
function normField(f: string | undefined | null): string {
  return String(f ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** HH:MM -> minutes since midnight. Returns null for blank/malformed input,
 *  which callers treat as "time unknown" rather than as midnight. */
export function minutesOf(time: string | undefined | null): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Do two games overlap in time, given a game length? With gameMinutes 0 this
 *  is an exact start-time match. Games with an unknown time never "overlap" —
 *  they are reported separately as `missing_time`, so a blank field cannot
 *  masquerade as a confirmed collision. */
function timesOverlap(
  aTime: string | undefined,
  bTime: string | undefined,
  gameMinutes: number,
): boolean {
  const a = minutesOf(aTime);
  const b = minutesOf(bTime);
  if (a === null || b === null) return false;
  if (gameMinutes <= 0) return a === b;
  return a < b + gameMinutes && b < a + gameMinutes;
}

function labelFor(teams: Map<string, ConflictTeam>, id: string): string {
  return teams.get(id)?.name?.trim() || id;
}

/** Pretty-print a time for admin-facing messages; falls back to the raw value
 *  so a malformed entry is visible rather than silently blanked. */
function showTime(time: string | undefined): string {
  const mins = minutesOf(time);
  if (mins === null) return String(time ?? "").trim() || "no time set";
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * Every conflict across `games`, and between `games` and any existing ones.
 *
 * Order of the returned list is stable: errors before warnings, then by date.
 * Callers can present it directly without re-sorting.
 */
export function findConflicts(
  games: ConflictGame[],
  opts: FindConflictsOptions = {},
): Conflict[] {
  const gameMinutes = Math.max(0, Math.floor(opts.gameMinutes ?? 0));
  const teams = new Map((opts.teams ?? []).map((t) => [t.id, t]));
  const conflicts: Conflict[] = [];

  // Existing games are indexed negatively so one loop can walk both sets while
  // still telling them apart: index < 0 means "already stored, not the row the
  // admin is adding".
  const existing = opts.existingGames ?? [];
  const all: { g: ConflictGame; idx: number }[] = [
    ...games.map((g, i) => ({ g, idx: i })),
    ...existing.map((g, i) => ({ g, idx: -(i + 1) })),
  ];

  const isNew = (idx: number) => idx >= 0;
  const push = (
    c: Omit<Conflict, "gameIndexes" | "existingIds">,
    involved: { g: ConflictGame; idx: number }[],
  ) => {
    const gameIndexes = involved.filter((x) => isNew(x.idx)).map((x) => x.idx);
    const existingIds = involved
      .filter((x) => !isNew(x.idx) && x.g.id)
      .map((x) => x.g.id!);
    // A pair of already-stored games conflicting with each other is pre-existing
    // state, not something this save introduced. Reporting it here would make
    // every future save fail on damage done earlier, so it is left alone.
    if (gameIndexes.length === 0) return;
    conflicts.push({ ...c, gameIndexes, existingIds });
  };

  // ---- 1. field double-booking -------------------------------------------
  // Bucket by date + field, then compare within the bucket. Bucketing first
  // keeps this near-linear instead of comparing every game to every other,
  // which matters at 185 teams and a full season of rows.
  const byDateField = new Map<string, { g: ConflictGame; idx: number }[]>();
  for (const entry of all) {
    const field = normField(entry.g.field);
    if (!field) continue; // no field assigned yet — nothing to collide over
    const key = `${entry.g.date}|${field}`;
    const list = byDateField.get(key);
    if (list) list.push(entry);
    else byDateField.set(key, [entry]);
  }

  for (const [, bucket] of byDateField) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]!;
        const b = bucket[j]!;
        const aHasTime = minutesOf(a.g.time) !== null;
        const bHasTime = minutesOf(b.g.time) !== null;

        if (!aHasTime || !bHasTime) {
          push(
            {
              kind: "missing_time",
              severity: "warning",
              date: a.g.date,
              field: a.g.field,
              time: a.g.time,
              teamIds: [
                a.g.away_team_id,
                a.g.home_team_id,
                b.g.away_team_id,
                b.g.home_team_id,
              ],
              message:
                `Two games share ${a.g.field} on ${a.g.date} but at least one has ` +
                `no start time, so an overlap cannot be ruled out. Set a start time ` +
                `on both.`,
            },
            [a, b],
          );
          continue;
        }

        if (!timesOverlap(a.g.time, b.g.time, gameMinutes)) continue;
        const sameStart = minutesOf(a.g.time) === minutesOf(b.g.time);
        push(
          {
            kind: "field_double_booked",
            severity: "error",
            date: a.g.date,
            field: a.g.field,
            time: a.g.time,
            teamIds: [
              a.g.away_team_id,
              a.g.home_team_id,
              b.g.away_team_id,
              b.g.home_team_id,
            ],
            message: sameStart
              ? `${a.g.field} is double-booked on ${a.g.date} at ${showTime(a.g.time)}: ` +
                `${labelFor(teams, a.g.away_team_id)} at ${labelFor(teams, a.g.home_team_id)} ` +
                `and ${labelFor(teams, b.g.away_team_id)} at ${labelFor(teams, b.g.home_team_id)}.`
              : `${a.g.field} on ${a.g.date}: ${showTime(a.g.time)} and ` +
                `${showTime(b.g.time)} are less than ${gameMinutes} minutes apart, ` +
                `so those games overlap on the same field.`,
          },
          [a, b],
        );
      }
    }
  }

  // ---- 2. a team in two places at once ------------------------------------
  // Same idea, bucketed by date + team. Independent of field: a team cannot be
  // at two parks simultaneously even when neither field is double-booked.
  const byDateTeam = new Map<string, { g: ConflictGame; idx: number }[]>();
  for (const entry of all) {
    for (const teamId of [entry.g.away_team_id, entry.g.home_team_id]) {
      if (!teamId) continue;
      const key = `${entry.g.date}|${teamId}`;
      const list = byDateTeam.get(key);
      if (list) list.push(entry);
      else byDateTeam.set(key, [entry]);
    }
  }

  for (const [key, bucket] of byDateTeam) {
    if (bucket.length < 2) continue;
    const teamId = key.slice(key.indexOf("|") + 1);
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]!;
        const b = bucket[j]!;
        if (!timesOverlap(a.g.time, b.g.time, gameMinutes)) continue;
        // A doubleheader on one field is legitimate when the slots do not
        // overlap; that is already excluded by timesOverlap above.
        push(
          {
            kind: "team_double_booked",
            severity: "error",
            date: a.g.date,
            field: a.g.field,
            time: a.g.time,
            teamIds: [teamId],
            message:
              `${labelFor(teams, teamId)} is scheduled twice on ${a.g.date} at ` +
              `${showTime(a.g.time)} — ${a.g.field || "no field"} and ` +
              `${b.g.field || "no field"}.`,
          },
          [a, b],
        );
      }
    }
  }

  // ---- 3. field eligibility ----------------------------------------------
  // Only new games are checked. Flagging stored games here would spam the
  // admin with rows they did not touch every time they save one new game.
  for (let i = 0; i < games.length; i++) {
    const g = games[i]!;
    const field = normField(g.field);
    if (!field) continue;
    for (const teamId of [g.away_team_id, g.home_team_id]) {
      const t = teams.get(teamId);
      const allowed = (t?.allowedFields ?? []).map(normField).filter(Boolean);
      if (allowed.length === 0) continue; // unrestricted
      if (allowed.includes(field)) continue;
      conflicts.push({
        kind: "field_not_allowed",
        severity: "error",
        date: g.date,
        field: g.field,
        time: g.time,
        teamIds: [teamId],
        gameIndexes: [i],
        existingIds: [],
        message:
          `${labelFor(teams, teamId)} is not permitted to play at ${g.field}. ` +
          `Allowed: ${(t?.allowedFields ?? []).join(", ")}.`,
      });
    }
  }

  // ---- 4. team unavailable on the date ------------------------------------
  for (let i = 0; i < games.length; i++) {
    const g = games[i]!;
    for (const teamId of [g.away_team_id, g.home_team_id]) {
      const t = teams.get(teamId);
      if (!(t?.unavailable ?? []).includes(g.date)) continue;
      conflicts.push({
        kind: "team_unavailable",
        severity: "error",
        date: g.date,
        field: g.field,
        time: g.time,
        teamIds: [teamId],
        gameIndexes: [i],
        existingIds: [],
        message: `${labelFor(teams, teamId)} is marked unavailable on ${g.date}.`,
      });
    }
  }

  const rank = (c: Conflict) => (c.severity === "error" ? 0 : 1);
  return conflicts.sort(
    (a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date),
  );
}

/**
 * The fields a matchup may legally use — the intersection of both teams'
 * allowed sets, preserving the order the fields were given in so the caller's
 * preference ordering survives.
 *
 * Returns every candidate when neither team is restricted. An empty result
 * means the pairing has no legal field at all, which is a configuration
 * problem worth surfacing before a schedule is generated rather than after.
 */
export function legalFieldsFor(
  awayTeam: ConflictTeam | undefined,
  homeTeam: ConflictTeam | undefined,
  candidateFields: string[],
): string[] {
  const restrict = (t: ConflictTeam | undefined): Set<string> | null => {
    const list = (t?.allowedFields ?? []).map(normField).filter(Boolean);
    return list.length === 0 ? null : new Set(list);
  };
  const a = restrict(awayTeam);
  const h = restrict(homeTeam);
  if (!a && !h) return [...candidateFields];
  return candidateFields.filter((f) => {
    const n = normField(f);
    return (!a || a.has(n)) && (!h || h.has(n));
  });
}

/** Convenience for callers that only need a yes/no gate before writing. */
export function hasBlockingConflict(conflicts: Conflict[]): boolean {
  return conflicts.some((c) => c.severity === "error");
}

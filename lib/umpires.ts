// Umpire roster and game assignment.
//
// An umpire is scheduled against the same physical reality a field is: they
// cannot be in two places at once, and they cannot work a date they said they
// are unavailable. So assignment reuses the shape of lib/schedule-conflicts
// rather than inventing a second, subtly-different notion of "conflict".
//
// What is deliberately NOT modelled: pay rates, invoicing, and ratings. LCYBL
// pays a per-game fee set in its rules document, and a league that assigns
// umpires through a chapter (as LCYBL does through Lancaster PIAA) does not
// want a second system of record for money. Assignment only.
//
// Pure — no Firestore, no clock.

export interface Umpire {
  id: string;
  name: string;
  /** Certification tier as the league words it, e.g. "PIAA", "Junior". Free
   *  text: leagues do not agree on tiers and inventing an enum would fight
   *  every one of them. */
  level?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Dates this umpire cannot work, YYYY-MM-DD. */
  unavailable?: string[] | null;
  /** Fields/complexes this umpire will travel to. Empty = anywhere. */
  fields?: string[] | null;
  active?: boolean;
}

/** A game, as far as assignment cares. */
export interface AssignableGame {
  id: string;
  date: string;
  time?: string;
  field?: string;
  division?: string;
  /** Umpire ids already assigned to this game. */
  umpires?: string[];
}

export type UmpireIssueKind =
  | "double_booked"
  | "unavailable"
  | "field_not_travelled"
  | "understaffed"
  | "missing_time";

export interface UmpireIssue {
  kind: UmpireIssueKind;
  severity: "error" | "warning";
  message: string;
  gameIds: string[];
  umpireId?: string;
}

const normField = (f?: string | null) =>
  String(f ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** HH:MM -> minutes. null when absent or malformed, which callers treat as
 *  "time unknown" rather than midnight. */
export function minutesOf(time?: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

function overlaps(a?: string, b?: string, gameMinutes = 0): boolean {
  const x = minutesOf(a);
  const y = minutesOf(b);
  if (x === null || y === null) return false;
  if (gameMinutes <= 0) return x === y;
  return x < y + gameMinutes && y < x + gameMinutes;
}

/**
 * Everything wrong with a set of umpire assignments.
 *
 * `requiredPerGame` defaults to 0 — a league that only ever assigns a plate
 * umpire should not be told every game is understaffed. Set it to state a
 * real requirement.
 */
export function findUmpireIssues(
  games: AssignableGame[],
  umpires: Umpire[],
  opts: { gameMinutes?: number; requiredPerGame?: number } = {},
): UmpireIssue[] {
  const gameMinutes = Math.max(0, Math.floor(opts.gameMinutes ?? 0));
  const required = Math.max(0, Math.floor(opts.requiredPerGame ?? 0));
  const byId = new Map(umpires.map((u) => [u.id, u]));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const issues: UmpireIssue[] = [];

  // ── one umpire, two games at once ────────────────────────────────
  // Bucketed by date + umpire so this stays near-linear over a season.
  const byDateUmp = new Map<string, AssignableGame[]>();
  for (const g of games) {
    for (const uid of g.umpires ?? []) {
      const key = `${g.date}|${uid}`;
      const list = byDateUmp.get(key);
      if (list) list.push(g);
      else byDateUmp.set(key, [g]);
    }
  }
  for (const [key, list] of byDateUmp) {
    if (list.length < 2) continue;
    const uid = key.slice(key.indexOf("|") + 1);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (minutesOf(a.time) === null || minutesOf(b.time) === null) {
          issues.push({
            kind: "missing_time",
            severity: "warning",
            umpireId: uid,
            gameIds: [a.id, b.id],
            message:
              `${nameOf(uid)} has two games on ${a.date} but at least one has ` +
              `no start time, so an overlap cannot be ruled out.`,
          });
          continue;
        }
        if (!overlaps(a.time, b.time, gameMinutes)) continue;
        issues.push({
          kind: "double_booked",
          severity: "error",
          umpireId: uid,
          gameIds: [a.id, b.id],
          message:
            `${nameOf(uid)} is assigned to two games at once on ${a.date} — ` +
            `${a.field || "no field"} and ${b.field || "no field"}.`,
        });
      }
    }
  }

  // ── availability and travel ──────────────────────────────────────
  for (const g of games) {
    for (const uid of g.umpires ?? []) {
      const u = byId.get(uid);
      if (!u) continue;
      if ((u.unavailable ?? []).includes(g.date)) {
        issues.push({
          kind: "unavailable",
          severity: "error",
          umpireId: uid,
          gameIds: [g.id],
          message: `${nameOf(uid)} is marked unavailable on ${g.date}.`,
        });
      }
      const travels = (u.fields ?? []).map(normField).filter(Boolean);
      if (travels.length > 0 && g.field && !travels.includes(normField(g.field))) {
        issues.push({
          kind: "field_not_travelled",
          severity: "error",
          umpireId: uid,
          gameIds: [g.id],
          message: `${nameOf(uid)} does not cover ${g.field}.`,
        });
      }
    }
  }

  // ── understaffed ─────────────────────────────────────────────────
  if (required > 0) {
    for (const g of games) {
      const n = (g.umpires ?? []).length;
      if (n >= required) continue;
      issues.push({
        kind: "understaffed",
        severity: "warning",
        gameIds: [g.id],
        message:
          `${g.date}${g.time ? ` ${g.time}` : ""} ${g.field || ""} needs ` +
          `${required} umpire${required === 1 ? "" : "s"}, has ${n}.`,
      });
    }
  }

  const rank = (i: UmpireIssue) => (i.severity === "error" ? 0 : 1);
  return issues.sort((a, b) => rank(a) - rank(b));
}

/**
 * Umpires who can legally take a game — available that date, willing to travel
 * to that field, and not already committed at that time.
 *
 * Ordered by how few games they already have, so the busiest official is not
 * offered first and the work spreads across the roster.
 */
export function eligibleUmpires(
  game: AssignableGame,
  umpires: Umpire[],
  allGames: AssignableGame[],
  opts: { gameMinutes?: number } = {},
): Umpire[] {
  const gameMinutes = Math.max(0, Math.floor(opts.gameMinutes ?? 0));

  const load = new Map<string, number>();
  const busy = new Map<string, AssignableGame[]>();
  for (const g of allGames) {
    for (const uid of g.umpires ?? []) {
      load.set(uid, (load.get(uid) ?? 0) + 1);
      const key = `${g.date}|${uid}`;
      busy.set(key, [...(busy.get(key) ?? []), g]);
    }
  }

  return umpires
    .filter((u) => u.active !== false)
    .filter((u) => !(u.unavailable ?? []).includes(game.date))
    .filter((u) => {
      const travels = (u.fields ?? []).map(normField).filter(Boolean);
      return travels.length === 0 || !game.field || travels.includes(normField(game.field));
    })
    .filter((u) => !(game.umpires ?? []).includes(u.id))
    .filter((u) => {
      const already = busy.get(`${game.date}|${u.id}`) ?? [];
      return !already.some(
        (g) => g.id !== game.id && overlaps(g.time, game.time, gameMinutes),
      );
    })
    .sort(
      (a, b) =>
        (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) ||
        a.name.localeCompare(b.name),
    );
}

/** Games per umpire, for the roster view. Includes umpires with none, so an
 *  official who has been forgotten is visible rather than absent. */
export function assignmentCounts(
  umpires: Umpire[],
  games: AssignableGame[],
): { umpire: Umpire; count: number }[] {
  const load = new Map<string, number>();
  for (const g of games) {
    for (const uid of g.umpires ?? []) load.set(uid, (load.get(uid) ?? 0) + 1);
  }
  return umpires
    .map((u) => ({ umpire: u, count: load.get(u.id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.umpire.name.localeCompare(b.umpire.name));
}

// The extra scheduling rules the GameSlate engine understands, as the Build
// Schedule screen collects them and as /api/admin-schedule-generate stores
// them (site_config/schedule_rules.gameslate).
//
// One normaliser, used on BOTH sides. The screen runs it over whatever is in
// the saved document, the API runs it over whatever the browser posted, so a
// value outside the bounds below can neither be saved nor acted on, and a
// document written by an older build still reads back as a complete rule set.
//
// No engine import here on purpose: the API route pulls this in, and the
// engine is a browser-side concern.

export const GAMESLATE_TEAM_ID_RE = /^[a-z0-9_-]+$/i;

export interface GameslateRules {
  /** 0 = fill the calendar (the platform engine's behaviour); 1..3 = every
   *  allowed pair meets that many times, then stop. A games-per-team target
   *  set on the screen wins over this. */
  cycles: 0 | 1 | 2 | 3;
  /** How long a game holds its court, minutes. 0 = only an identical start
   *  time counts as taken. */
  gameMinutes: number;
  /** Hard cap on one team's games in a day. 0 = no cap. */
  maxPerTeamPerDay: number;
  /** Two games on one day: keep them apart, allow, or pull them together. */
  doubleheaders: "avoid" | "allow" | "prefer";
  /** Least minutes between the end of one game and the start of the same
   *  team's next, same day. */
  minGapMinutes: number;
  /** Most minutes a team waits between same-day games. 0 = no limit. */
  maxGapMinutes: number;
  /** Least days between a team's games on different days. */
  minDaysRest: number;
  slotPreference: "balanced" | "early" | "late";
  /** Where the host has a home venue: nudge the game there, or insist. */
  homeFieldRule: "prefer" | "require";
  /** No rematch within this many weeks of the last meeting. 0 = no rule. */
  noRematchWeeks: number;
  /** A team is never home, or away, more than this many games running. 0 =
   *  no rule. */
  maxConsecutive: number;
  /** Home and home: when two teams meet again, last time's visitor hosts. */
  pairAlternate: boolean;
  /** Teams that can never play at overlapping times: one coach with two
   *  teams, two siblings on two teams. Pairs; the adapter joins them into
   *  groups. */
  linkedPairs: [string, string][];
}

export const DEFAULT_GAMESLATE_RULES: GameslateRules = {
  cycles: 0,
  gameMinutes: 0,
  maxPerTeamPerDay: 0,
  doubleheaders: "allow",
  minGapMinutes: 0,
  maxGapMinutes: 0,
  minDaysRest: 0,
  slotPreference: "balanced",
  homeFieldRule: "prefer",
  noRematchWeeks: 0,
  maxConsecutive: 0,
  pairAlternate: false,
  linkedPairs: [],
};

function int(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], dflt: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
}

/** Whatever came in — a saved document, a posted body, nothing at all — out
 *  comes a complete, in-bounds rule set. Unknown keys are dropped. */
export function normaliseGameslateRules(raw: unknown): GameslateRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_GAMESLATE_RULES;

  const seen = new Set<string>();
  const linkedPairs: [string, string][] = [];
  if (Array.isArray(r.linkedPairs)) {
    for (const p of r.linkedPairs) {
      if (!Array.isArray(p) || p.length !== 2) continue;
      const a = String(p[0] ?? "");
      const b = String(p[1] ?? "");
      if (!a || !b || a === b) continue;
      if (!GAMESLATE_TEAM_ID_RE.test(a) || !GAMESLATE_TEAM_ID_RE.test(b)) continue;
      const key = [a, b].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      linkedPairs.push([a, b]);
      if (linkedPairs.length >= 200) break;
    }
  }

  return {
    cycles: int(r.cycles, 0, 3, d.cycles) as GameslateRules["cycles"],
    gameMinutes: int(r.gameMinutes, 0, 300, d.gameMinutes),
    maxPerTeamPerDay: int(r.maxPerTeamPerDay, 0, 4, d.maxPerTeamPerDay),
    doubleheaders: oneOf(r.doubleheaders, ["avoid", "allow", "prefer"] as const, d.doubleheaders),
    minGapMinutes: int(r.minGapMinutes, 0, 240, d.minGapMinutes),
    maxGapMinutes: int(r.maxGapMinutes, 0, 480, d.maxGapMinutes),
    minDaysRest: int(r.minDaysRest, 0, 6, d.minDaysRest),
    slotPreference: oneOf(r.slotPreference, ["balanced", "early", "late"] as const, d.slotPreference),
    homeFieldRule: oneOf(r.homeFieldRule, ["prefer", "require"] as const, d.homeFieldRule),
    noRematchWeeks: int(r.noRematchWeeks, 0, 8, d.noRematchWeeks),
    maxConsecutive: int(r.maxConsecutive, 0, 6, d.maxConsecutive),
    pairAlternate: r.pairAlternate === true,
    linkedPairs,
  };
}

/** Pairs into groups: [a,b] + [b,c] is one group of three, because a coach
 *  with three teams cannot be at two of their games either. */
export function linkedGroups(pairs: [string, string][]): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let p = parent.get(x)!;
    while (p !== x) {
      const gp = parent.get(p)!;
      parent.set(x, gp);
      x = p;
      p = gp;
    }
    return x;
  };
  for (const [a, b] of pairs) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    groups.set(root, [...(groups.get(root) ?? []), id]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort());
}

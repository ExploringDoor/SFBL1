// Bracket logic — PORTED, not rewritten, from js/sts-bracket.js in the STSBT
// site, which its own header notes was ported from the Node-tested D27 engine.
// The same code renders the brackets on D27, STSBT and Texas Select, and this
// exists so league-platform tenants get that identical bracket rather than a
// second implementation that drifts.
//
// The model is advancement REFERENCES, not pre-resolved teams:
//
//   away/home is either a real team name, or
//   "WG-n"  the WINNER of game n
//   "LG-n"  the LOSER of game n
//
// which is what lets a bracket be drawn before a single game is played, and is
// what the layout uses to work out columns, rows and connector lines.
//
// Kept deliberately close to the JavaScript original (same function names, same
// order, same edge cases) so the two can be diffed when either changes.

export interface BracketRefGame {
  g: number;
  away: string;
  home: string;
  away_score?: number | null;
  home_score?: number | null;
  done?: boolean;
  date?: string | null;
  time?: string | null;
  field?: string | null;
  division?: string | null;
}

export interface BracketTournament {
  games: BracketRefGame[];
}

export type Ref =
  | { kind: "team"; name: string }
  | { kind: "bye" }
  | { kind: "tbd"; label?: string; seed?: number }
  | { kind: "WG"; g: number }
  | { kind: "LG"; g: number };

export function parseRef(s: unknown): Ref {
  if (s == null) return { kind: "tbd" };
  const t = String(s).trim();
  let m = /^WG-(\d+)$/i.exec(t);
  if (m) return { kind: "WG", g: +m[1]! };
  m = /^LG-(\d+)$/i.exec(t);
  if (m) return { kind: "LG", g: +m[1]! };
  if (/if necessary/i.test(t)) return { kind: "tbd", label: "If necessary" };
  if (/^bye$/i.test(t)) return { kind: "bye" };
  // "Seed N" = an as-yet-unseeded slot (bracket scheduled before teams are
  // set); render as a greyed placeholder, never a broken team link.
  m = /^seed\s*(\d+)$/i.exec(t);
  if (m) return { kind: "tbd", label: "Seed " + m[1], seed: +m[1]! };
  return { kind: "team", name: t };
}

export function gameByNum(t: BracketTournament, n: number): BracketRefGame | undefined {
  return (t.games || []).find((g) => g.g === n);
}

export function isPlayed(g?: BracketRefGame | null): boolean {
  return !!g && g.done === true && g.away_score != null && g.home_score != null;
}

export function resolveSide(
  t: BracketTournament,
  ref: Ref,
  seen?: Set<number>,
): string | null {
  const s = seen ?? new Set<number>();
  if (ref.kind === "team") return ref.name;
  if (ref.kind === "bye") return "BYE";
  if (ref.kind !== "WG" && ref.kind !== "LG") return null;
  const g = gameByNum(t, ref.g);
  if (!g || s.has(ref.g)) return null;
  s.add(ref.g);
  return ref.kind === "WG" ? winnerName(t, g, s) : loserName(t, g, s);
}

function winnerName(t: BracketTournament, g: BracketRefGame, seen: Set<number>): string | null {
  if (!isPlayed(g)) return null;
  const a = resolveSide(t, parseRef(g.away), new Set(seen));
  const h = resolveSide(t, parseRef(g.home), new Set(seen));
  return g.away_score! > g.home_score! ? a : g.home_score! > g.away_score! ? h : null;
}

function loserName(t: BracketTournament, g: BracketRefGame, seen: Set<number>): string | null {
  if (!isPlayed(g)) return null;
  const a = resolveSide(t, parseRef(g.away), new Set(seen));
  const h = resolveSide(t, parseRef(g.home), new Set(seen));
  return g.away_score! > g.home_score! ? h : g.home_score! > g.away_score! ? a : null;
}

export function feeders(g: BracketRefGame): number[] {
  const o: number[] = [];
  for (const raw of [g.away, g.home]) {
    const r = parseRef(raw);
    if (r.kind === "WG" || r.kind === "LG") o.push(r.g);
  }
  return o;
}

export function computeRounds(t: BracketTournament): Record<number, number> {
  const depth: Record<number, number> = {};
  const guard = new Set<number>();
  function d(n: number): number {
    if (depth[n] != null) return depth[n]!;
    if (guard.has(n)) return 1;
    guard.add(n);
    const g = gameByNum(t, n);
    if (!g) return 1;
    const f = feeders(g);
    const r = f.length ? 1 + Math.max(...f.map(d)) : 1;
    depth[n] = r;
    return r;
  }
  (t.games || []).forEach((g) => d(g.g));
  return depth;
}

/** winners ("w") / losers ("l") / championship ("f") per game number. */
export function classify(t: BracketTournament): Record<number, "w" | "l" | "f"> {
  const pw: Record<number, boolean> = {};
  const guard = new Set<number>();
  function isPw(n: number): boolean {
    if (pw[n] != null) return pw[n]!;
    if (guard.has(n)) return true;
    guard.add(n);
    const g = gameByNum(t, n);
    if (!g) {
      pw[n] = true;
      return true;
    }
    let v = true;
    for (const raw of [g.away, g.home]) {
      const r = parseRef(raw);
      if (r.kind === "LG") v = false;
      if (r.kind === "WG" && !isPw(r.g)) v = false;
    }
    pw[n] = v;
    return v;
  }
  (t.games || []).forEach((g) => isPw(g.g));

  const depth = computeRounds(t);
  let wbFinal: number | null = null;
  let wbDepth = -1;
  (t.games || []).forEach((g) => {
    if (pw[g.g] && (depth[g.g] || 1) > wbDepth) {
      wbDepth = depth[g.g] || 1;
      wbFinal = g.g;
    }
  });

  const consumers: Record<number, number[]> = {};
  (t.games || []).forEach((g) => {
    for (const raw of [g.away, g.home]) {
      const r = parseRef(raw);
      if (r.kind === "WG" || r.kind === "LG") (consumers[r.g] ||= []).push(g.g);
    }
  });

  const fin = new Set<number>();
  if (wbFinal != null) {
    const q = (consumers[wbFinal] || []).filter((n) => {
      const g = gameByNum(t, n);
      if (!g) return false;
      const a = parseRef(g.away);
      const h = parseRef(g.home);
      return (a.kind === "WG" && a.g === wbFinal) || (h.kind === "WG" && h.g === wbFinal);
    });
    while (q.length) {
      const n = q.shift()!;
      if (fin.has(n)) continue;
      fin.add(n);
      (consumers[n] || []).forEach((c) => q.push(c));
    }
    if (!fin.size) fin.add(wbFinal);
  }

  const cls: Record<number, "w" | "l" | "f"> = {};
  (t.games || []).forEach((g) => {
    cls[g.g] = fin.has(g.g) ? "f" : pw[g.g] ? "w" : "l";
  });
  return cls;
}

export function championOutcome(
  t: BracketTournament,
  cls: Record<number, "w" | "l" | "f">,
): { champion: string | null; hide: Set<number> } {
  const finals = (t.games || [])
    .filter((g) => cls[g.g] === "f")
    .sort((a, b) => a.g - b.g);
  const hide = new Set<number>();
  if (!finals.length) return { champion: null, hide };
  const gf = finals[0]!;
  const feederCls = (raw: string) => {
    const r = parseRef(raw);
    return r.kind === "WG" || r.kind === "LG" ? cls[r.g] : null;
  };
  const winnersSide =
    feederCls(gf.away) === "w" ? "away" : feederCls(gf.home) === "w" ? "home" : "away";
  // A double-elim grand final needs the losers-bracket team to win TWICE.
  // Detected by a reset game (>1 final) OR a losers-bracket feeder — the
  // feeder-class check alone misses the 2-team case where both trace to G1.
  const isGrandFinal =
    finals.length > 1 || feederCls(gf.away) === "l" || feederCls(gf.home) === "l";
  let champion: string | null = null;
  if (isPlayed(gf)) {
    const winSide =
      gf.away_score! > gf.home_score! ? "away" : gf.home_score! > gf.away_score! ? "home" : null;
    if (winSide && (!isGrandFinal || winSide === winnersSide)) {
      champion = resolveSide(t, parseRef(winSide === "away" ? gf.away : gf.home), new Set());
      finals.slice(1).forEach((g) => hide.add(g.g));
    } else if (winSide) {
      const dec = finals[1];
      if (dec && isPlayed(dec)) {
        const ds =
          dec.away_score! > dec.home_score!
            ? "away"
            : dec.home_score! > dec.away_score!
              ? "home"
              : null;
        if (ds) champion = resolveSide(t, parseRef(ds === "away" ? dec.away : dec.home), new Set());
      }
    }
  }
  return { champion, hide };
}

export interface SideDisplay {
  name: string;
  tbd?: boolean;
  bye?: boolean;
  via?: string;
}

/** A side as it should be shown, with a "via Gn" note for a resolved ref. */
export function sideDisplay(t: BracketTournament, raw: string): SideDisplay {
  const ref = parseRef(raw);
  if (ref.kind === "team") return { name: ref.name };
  if (ref.kind === "bye") return { name: "BYE", tbd: true, bye: true };
  if (ref.kind === "tbd") return { name: ref.label || "TBD", tbd: true };
  const resolved = resolveSide(t, ref, new Set());
  if (resolved) return { name: resolved, via: "G" + ref.g };
  return { name: (ref.kind === "WG" ? "Winner" : "Loser") + " G" + ref.g, tbd: true };
}

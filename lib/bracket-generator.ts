// Single / double elimination bracket generator.
//
// PORTED, not rewritten. The source is js/sts-tourney-gen.js in the STSBT site,
// which its own header notes was ported from the Node-tested D27 engine. That
// logic has run real tournaments for two seasons, so this keeps its structure
// and its edge cases rather than inventing a second implementation.
//
// Deliberately taken from STSBT and not from the older copies: the same bracket
// code was duplicated across several sites and drifted, and the placement bug
// (in an 8-team double elim the first team eliminated was published as 4th and
// the losers-final loser pushed to 5th) was fixed on the STS/STX side only.
//
// The model is advancement references rather than pre-resolved teams:
//
//   away/home is either a real team name, or
//   "WG-n"  the WINNER of game n
//   "LG-n"  the LOSER of game n
//
// which is what lets a bracket be built before a single game is played, and is
// the same shape the STS bracket renderer resolves.

export interface BracketGame {
  /** Game number, 1-based and unique within the bracket. */
  g: number;
  /** Team name, or a "WG-n" / "LG-n" reference. */
  away: string;
  home: string;
  /** True for the game (or games) that decide the title. */
  champ?: boolean;
  /** Which side of a double-elim bracket this game belongs to. */
  bracket?: "winners" | "losers" | "final";
  /** 1-based round within its side, for grouping in the UI. */
  round?: number;
}

export interface BracketOptions {
  teams: string[];
  format?: "single" | "double";
  /** First game number, when appending to an existing bracket. */
  startGame?: number;
}

const nextPow2 = (n: number) => {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
};

/** Standard single-elim seed order for a power-of-2 bracket: 1 plays the
 *  lowest seed, 2 plays the next lowest, and so on down the bracket. */
export function seedSlots(size: number): number[] {
  let seeds = [1, 2];
  while (seeds.length < size) {
    const sum = seeds.length * 2 + 1;
    const next: number[] = [];
    for (const s of seeds) {
      next.push(s);
      next.push(sum - s);
    }
    seeds = next;
  }
  return seeds;
}

type Slot = string | null;

function buildWinners(teams: string[], startG: number) {
  const N = teams.length;
  const size = nextPow2(N);
  const seeds = seedSlots(size);
  // Seeds beyond the team count are byes (null), which is how an odd or
  // non-power-of-2 field advances its top seeds automatically.
  const slot: Slot[] = seeds.map((sd) => (sd <= N ? teams[sd - 1]! : null));

  const games: BracketGame[] = [];
  let g = startG - 1;
  const waves: Slot[][] = [];
  let adv: Slot[] = [];
  const wave1: Slot[] = [];
  let round = 1;

  for (let i = 0; i < size; i += 2) {
    const a = slot[i] ?? null;
    const b = slot[i + 1] ?? null;
    if (a && b) {
      g++;
      games.push({ g, away: a, home: b, bracket: "winners", round });
      adv.push(`WG-${g}`);
      wave1.push(`LG-${g}`);
    } else if (a || b) {
      adv.push(a || b);
      wave1.push(null);
    } else {
      adv.push(null);
      wave1.push(null);
    }
  }
  waves.push(wave1);

  while (adv.length > 1) {
    round++;
    const next: Slot[] = [];
    const wave: Slot[] = [];
    for (let j = 0; j < adv.length; j += 2) {
      const x = adv[j] ?? null;
      const y = adv[j + 1] ?? null;
      if (x && y) {
        g++;
        games.push({ g, away: x, home: y, bracket: "winners", round });
        next.push(`WG-${g}`);
        wave.push(`LG-${g}`);
      } else if (x || y) {
        next.push(x || y!);
        wave.push(null);
      } else {
        next.push(null);
        wave.push(null);
      }
    }
    adv = next;
    waves.push(wave);
  }
  return { games, waves, wbChampRef: adv[0] ?? null, lastG: g };
}

function buildLosers(waves: Slot[][], startG: number) {
  const games: BracketGame[] = [];
  let g = startG - 1;
  const k = waves.length;
  let round = 0;

  // Pair the survivors against each other.
  function pairUp(refs: Slot[]): Slot[] {
    round++;
    const out: Slot[] = [];
    for (let i = 0; i < refs.length; i += 2) {
      const a = refs[i] ?? null;
      const b = refs[i + 1] ?? null;
      if (a && b) {
        g++;
        games.push({ g, away: a, home: b, bracket: "losers", round });
        out.push(`WG-${g}`);
      } else if (a || b) out.push(a || b!);
      else out.push(null);
    }
    return out;
  }

  // Take on the teams just knocked out of the winners bracket. Reversed so the
  // newest drops meet the survivors from the opposite side of the draw, which
  // is what stops an immediate rematch.
  function absorb(surv: Slot[], drops: Slot[]): Slot[] {
    round++;
    const d = drops.slice().reverse();
    const out: Slot[] = [];
    const len = Math.max(surv.length, d.length);
    for (let i = 0; i < len; i++) {
      const a = surv[i] ?? null;
      const b = d[i] ?? null;
      if (a && b) {
        g++;
        games.push({ g, away: a, home: b, bracket: "losers", round });
        out.push(`WG-${g}`);
      } else if (a || b) out.push(a || b!);
      else out.push(null);
    }
    return out;
  }

  let surv = pairUp(waves[0] ?? []);
  for (let r = 1; r < k; r++) {
    surv = absorb(surv, waves[r] ?? []);
    if (r < k - 1) surv = pairUp(surv);
  }
  const lbChampRef = surv.find((s) => s != null) ?? null;
  return { games, lbChampRef, lastG: g };
}

function buildFinal(wbChampRef: Slot, lbChampRef: Slot, startG: number) {
  // Grand final, then the "if necessary" reset. The reset is a rematch of the
  // grand final — its winner against its loser — so BOTH sides resolve to real
  // teams. Writing it as anything else is what made earlier versions render an
  // empty second final.
  const games: BracketGame[] = [
    {
      g: startG,
      away: wbChampRef ?? "",
      home: lbChampRef ?? "",
      bracket: "final",
      round: 1,
    },
    {
      g: startG + 1,
      away: `WG-${startG}`,
      home: `LG-${startG}`,
      bracket: "final",
      round: 2,
    },
  ];
  return { games, lastG: startG + 1 };
}

/**
 * Build a full bracket. Teams are given in seed order (index 0 is the 1 seed).
 * Returns games in play order, each with the side and round it belongs to.
 */
export function generateBracket(opts: BracketOptions): BracketGame[] {
  const teams = (opts.teams ?? []).map((t) => String(t).trim()).filter(Boolean);
  const startG = opts.startGame ?? 1;
  if (teams.length < 2) return [];

  const wb = buildWinners(teams, startG);
  if ((opts.format ?? "single") !== "double") {
    if (wb.games.length) wb.games[wb.games.length - 1]!.champ = true;
    return wb.games;
  }
  const lb = buildLosers(wb.waves, wb.lastG + 1);
  const fin = buildFinal(wb.wbChampRef, lb.lbChampRef, lb.lastG + 1);
  fin.games.forEach((g) => (g.champ = true));
  return [...wb.games, ...lb.games, ...fin.games];
}

/** Game number a "WG-n" / "LG-n" reference points at, or null for a real team. */
export function refGameNum(s: string): number | null {
  const m = /^(?:WG|LG)-(\d+)$/i.exec(String(s ?? "").trim());
  return m ? Number(m[1]) : null;
}

/** True when the value is an actual team rather than an advancement pointer. */
export function isRealTeam(s: string): boolean {
  const v = String(s ?? "").trim();
  return v.length > 0 && refGameNum(v) === null;
}

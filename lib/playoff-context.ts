// Where a playoff game sits in the bracket — division, round, and whether
// it's the championship. Used to give the auto-generated recap its stakes
// ("in Round 1 of the 35+ National playoffs", "Southern Yankees advance")
// instead of reading like a regular-season Tuesday.
//
// Matching a game to its bracket slot is deliberately forgiving. Bracket
// matches rarely store a game_id, and a later-round card often still reads
// "TBD vs Delray" because the previous round's winner was never typed in.
// So we try, in order: the explicit game_id, then both teams, then a single
// team against a TBD slot — the last only when it's unambiguous.

export interface PlayoffContext {
  divisionLabel: string;
  roundLabel: string;
  /** Last round of its division — i.e. the championship game. */
  isFinalRound: boolean;
}

interface RawMatch {
  game_id?: unknown;
  away_team_id?: unknown;
  home_team_id?: unknown;
}
interface RawRound {
  label?: unknown;
  matches?: RawMatch[];
}
interface RawDivision {
  label?: unknown;
  rounds?: RawRound[];
}

// A real team id, or null for any flavor of "not decided yet".
function teamId(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" || s.toLowerCase() === "tbd" ? null : s;
}

export function findPlayoffContext(
  bracketData: unknown,
  game: { gameId: string; awayTeamId: string; homeTeamId: string },
): PlayoffContext | null {
  const divisions = (bracketData as { divisions?: RawDivision[] } | null)
    ?.divisions;
  if (!Array.isArray(divisions)) return null;

  const gAway = teamId(game.awayTeamId);
  const gHome = teamId(game.homeTeamId);
  const teams = new Set([gAway, gHome].filter(Boolean) as string[]);

  const ctxAt = (div: RawDivision, ri: number): PlayoffContext => {
    const rounds = div.rounds ?? [];
    return {
      divisionLabel: String(div.label ?? "").trim(),
      roundLabel: String(rounds[ri]?.label ?? "").trim(),
      isFinalRound: ri === rounds.length - 1,
    };
  };

  // Pass 1 — an explicit game_id, or both teams on the same card.
  const partials: PlayoffContext[] = [];
  for (const div of divisions) {
    const rounds = div.rounds ?? [];
    for (let ri = 0; ri < rounds.length; ri++) {
      for (const m of rounds[ri]?.matches ?? []) {
        if (m.game_id && String(m.game_id) === game.gameId) {
          return ctxAt(div, ri);
        }
        const a = teamId(m.away_team_id);
        const h = teamId(m.home_team_id);
        if (a && h && teams.has(a) && teams.has(h) && a !== h) {
          return ctxAt(div, ri);
        }
        // One side decided, the other still TBD — a candidate only if
        // nothing better turns up and it's the sole such card.
        if (a && !h && teams.has(a)) partials.push(ctxAt(div, ri));
        else if (h && !a && teams.has(h)) partials.push(ctxAt(div, ri));
      }
    }
  }

  // Pass 2 — fall back to a half-filled card, but only when unambiguous.
  return partials.length === 1 ? partials[0]! : null;
}

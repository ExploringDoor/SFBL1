// Auto-generated recap text from a box score. Pattern lifted from Long
// Beach's buildRealRecap helper per the Phase 3 scouting report.
//
// Output is plain text with explicit line breaks — no HTML. The recap
// renderer wraps each entry in `body` in its own <p>. Commissioners can
// later edit the generated recap into a richer story; this is the
// floor, not the ceiling.
//
// We aim for 3–6 paragraphs covering: opener (game frame + score),
// player of the game, top batting performances, top pitching, late
// drama / inning highlights when the linescore reveals it, plus a
// closing line on what the result means.

import { calcPOTG, type POTGBatterLine, type POTGPitcherLine } from "./potg";
import { formatIP } from "./ip";
import { formatGameDate } from "@/lib/format-time";
import type { PlayoffContext } from "@/lib/playoff-context";

export interface RecapInput {
  awayTeamName: string;
  homeTeamName: string;
  awayScore: number;
  homeScore: number;
  awayLineup: POTGBatterLine[];
  homeLineup: POTGBatterLine[];
  awayPitchers: POTGPitcherLine[];
  homePitchers: POTGPitcherLine[];
  /** Map of player_id → display name for prose. */
  playerNames: Record<string, string>;
  /** Optional inning-by-inning runs scored. Used for "broke it open" /
   *  "late comeback" sentences when present. */
  awayLine?: number[];
  homeLine?: number[];
  /** Optional context fields, included if available. */
  field?: string | null;
  date?: string | null;
  /** When a team is in Score-Only mode, drop player highlights for
   *  that side — we only have the final score, no individual stats.
   *  The recap still mentions both teams in the opener and result
   *  framing. */
  awayScoreOnly?: boolean;
  homeScoreOnly?: boolean;
  /** Bracket position, when this is a playoff game. Lets the recap name
   *  the round and the stakes instead of reading like a June Tuesday. */
  playoff?: PlayoffContext | null;
}

export interface RecapOutput {
  headline: string;
  body: string[]; // paragraphs
  potg: { player_id: string; player_name: string; score: number; source: "batting" | "pitching" } | null;
}

export function buildRecap(input: RecapInput): RecapOutput {
  const aWin = input.awayScore > input.homeScore;
  const hWin = input.homeScore > input.awayScore;
  const margin = Math.abs(input.awayScore - input.homeScore);

  const winnerName = aWin
    ? input.awayTeamName
    : hWin
      ? input.homeTeamName
      : null;
  const loserName = aWin
    ? input.homeTeamName
    : hWin
      ? input.awayTeamName
      : null;
  const winnerScore = Math.max(input.awayScore, input.homeScore);
  const loserScore = Math.min(input.awayScore, input.homeScore);

  const headline =
    winnerName == null
      ? `${input.awayTeamName} and ${input.homeTeamName} played to a ${input.awayScore}–${input.homeScore} draw.`
      : `${winnerName} ${winnerStyle(margin)} ${loserName}, ${winnerScore}–${loserScore}.`;

  // Score-Only teams contribute no individual stats — drop their
  // (empty) lineups + pitchers before computing POTG / standouts /
  // pitching highlights so we never mention "no one" or pull a
  // false leader from sparse data.
  const awayBatters = input.awayScoreOnly ? [] : input.awayLineup;
  const homeBatters = input.homeScoreOnly ? [] : input.homeLineup;
  const awayPit = input.awayScoreOnly ? [] : input.awayPitchers;
  const homePit = input.homeScoreOnly ? [] : input.homePitchers;
  const allBatters = [...awayBatters, ...homeBatters];
  const allPitchers = [...awayPit, ...homePit];
  const potg = calcPOTG(allBatters, allPitchers);
  let potgWithName: RecapOutput["potg"] = null;
  if (potg) {
    const player_name = input.playerNames[potg.player_id] ?? potg.player_id;
    potgWithName = { ...potg, player_name };
  }

  // Two-paragraph recap. Paragraph 1 sets the scene + spotlights the
  // POTG. Paragraph 2 covers other standouts, pitching, and closes.
  // Multiple short stanzas read like a stat sheet — Adam asked for
  // this to flow like an article. Sentences inside a paragraph are
  // separated by a space so the browser line-wraps naturally.

  const sentencesP1: string[] = [];
  sentencesP1.push(
    opener(input, winnerName, loserName, winnerScore, loserScore, margin),
  );
  if (potg) {
    sentencesP1.push(
      potgSentence(potg, allBatters, allPitchers, input.playerNames),
    );
  }

  const sentencesP2: string[] = [];
  const standouts = standoutBatters(
    allBatters,
    input.playerNames,
    potg?.player_id,
  );
  if (standouts) sentencesP2.push(standouts);

  const pitchPara = pitchingParagraph(
    awayPit,
    homePit,
    input.playerNames,
    winnerName,
  );
  if (pitchPara) sentencesP2.push(pitchPara);

  // Both sides score-only: nothing to highlight, so the recap is the
  // opener plus whatever context we have. We used to print a "no
  // individual stats were recorded" disclaimer here; it added nothing
  // a reader wanted and repeated on every such recap (Adam, 2026-07).
  // The absence of a stat line speaks for itself.
  if (input.awayScoreOnly && input.homeScoreOnly) {
    sentencesP2.length = 0;
  } else if (input.awayScoreOnly) {
    sentencesP2.unshift(
      `${input.awayTeamName} submitted score-only — no individual stats recorded for them.`,
    );
  } else if (input.homeScoreOnly) {
    sentencesP2.unshift(
      `${input.homeTeamName} submitted score-only — no individual stats recorded for them.`,
    );
  }

  const inning = inningHighlight(input);
  if (inning) sentencesP2.push(inning);

  // Playoff stakes. Single elimination, so the loser's season is over —
  // worth saying plainly, and it's the line a regular-season recap can
  // never earn.
  if (input.playoff && winnerName) {
    sentencesP2.push(
      input.playoff.isFinalRound
        ? `${winnerName} are ${divisionPhrase(input.playoff)} champions.`
        : `${winnerName} advance; ${possessive(loserName!)} season is over.`,
    );
  }

  if (winnerName) {
    const closer = closingLine(winnerName, loserName!, margin);
    if (closer) sentencesP2.push(closer);
  }

  const body: string[] = [];
  if (sentencesP1.length > 0) body.push(sentencesP1.join(" "));
  if (sentencesP2.length > 0) body.push(sentencesP2.join(" "));

  return { headline, body, potg: potgWithName };
}

// ---------------------------------------------------------------------------

// "edged"/"beat"/"defeated" — purely a verb choice based on margin.
// We don't editorialize about pace ("rolled past", "dropped the
// hammer") here because we have no inning-level data on most games
// to back that up. The headline stays factual; if the linescore
// supports a narrative, addLinescoreBeat() adds a sentence after.
/** Possessive of a team name. Most SFBL names already end in s
 *  ("Boca Mets"), which takes a bare apostrophe — not "Mets's". */
function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/** "the 35+ National" — the division as it reads mid-sentence. Empty
 *  when the bracket has no division label (a single-bracket league). */
function divisionPhrase(p: PlayoffContext): string {
  const d = p.divisionLabel.trim();
  return d ? `the ${d}` : "the";
}

/** Where this game sits, as a phrase for the opener: "the 35+ National
 *  championship game", "Round 2 of the 35+ National playoffs". Rounds
 *  the admin already named "Final"/"Championship" are used as written
 *  rather than being restated. */
function playoffPhrase(p: PlayoffContext): string {
  const div = p.divisionLabel.trim();
  const round = p.roundLabel.trim();
  const namedFinal = /final|championship|title/i.test(round);

  if (p.isFinalRound && !namedFinal) {
    return div ? `the ${div} championship game` : "the championship game";
  }
  if (namedFinal) {
    return div ? `the ${div} ${round.toLowerCase()}` : `the ${round.toLowerCase()}`;
  }
  if (!round) return div ? `the ${div} playoffs` : "the playoffs";
  return div ? `${round} of the ${div} playoffs` : `${round} of the playoffs`;
}

function winnerStyle(margin: number): string {
  if (margin >= 6) return "defeated";
  if (margin >= 3) return "beat";
  if (margin === 1) return "edged";
  return "beat";
}

function opener(
  input: RecapInput,
  winnerName: string | null,
  loserName: string | null,
  winnerScore: number,
  loserScore: number,
  margin: number,
): string {
  const where = input.field ? ` at ${input.field}` : "";
  const stakes = input.playoff ? ` in ${playoffPhrase(input.playoff)}` : "";
  // Audit H1: formatGameDate parses date-only strings as a local
  // calendar day, so the recap headline doesn't slip a day for
  // Pacific (LBDC) readers. Recap only shows the day, no time.
  const whenStr = formatGameDate(input.date, null, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const when = whenStr ? ` on ${whenStr}` : "";

  if (winnerName == null) {
    return `${input.awayTeamName} and ${input.homeTeamName} finished tied ${input.awayScore}–${input.homeScore}${where}${when}${stakes}.`;
  }

  // Factual one-liner. We DO NOT claim "came down to the final at-
  // bat" or call anything a "thriller" / "rout" — we only have the
  // final score in many cases. If a linescore is present, a separate
  // sentence (linescoreBeat) describes what actually happened.
  const verb = winnerStyle(margin);
  const base = `${winnerName} ${verb} ${loserName} ${winnerScore}–${loserScore}${where}${when}${stakes}.`;
  const beat = linescoreBeat(input, winnerName, loserName!, margin);
  return beat ? `${base} ${beat}` : base;
}

/** Build a factual narrative sentence backed by the linescore. Only
 *  emitted when we have inning-by-inning runs for both teams.
 *  Examples we'll generate:
 *    "X scored 3 runs in the 5th to take a 5-2 lead, then held on."
 *    "Y plated the go-ahead run in the bottom of the 7th."
 *    "Both teams were scoreless until the 6th."
 *  We never make up tone — adjectives like "thriller", "blowout",
 *  "comeback" only appear when the linescore actually shows it. */
function linescoreBeat(
  input: RecapInput,
  winnerName: string,
  loserName: string,
  margin: number,
): string | null {
  const a = input.awayLine;
  const h = input.homeLine;
  if (!a || !h || a.length === 0 || h.length === 0) return null;

  const innings = Math.max(a.length, h.length);
  // Reconstruct the cumulative score after each half-inning. We need
  // to know whether the winning team led from the start, came back,
  // or scored the go-ahead in the final frame.
  let aCum = 0;
  let hCum = 0;
  let winnerLead = 0; // > 0 = winner leads, < 0 = winner trails, 0 = tied
  const winnerIsAway = winnerName === input.awayTeamName;
  let leadFlips = 0;
  let firstWinnerLeadInning: number | null = null;
  let lastTiedInning = -1;
  let goAheadInning: number | null = null;
  for (let i = 0; i < innings; i++) {
    aCum += a[i] ?? 0;
    hCum += h[i] ?? 0;
    const newWinnerLead = winnerIsAway ? aCum - hCum : hCum - aCum;
    const wasLeading = winnerLead > 0;
    const nowLeading = newWinnerLead > 0;
    if (wasLeading !== nowLeading && winnerLead !== 0 && newWinnerLead !== 0) {
      leadFlips++;
    }
    if (newWinnerLead > 0 && firstWinnerLeadInning === null) {
      firstWinnerLeadInning = i + 1;
    }
    if (newWinnerLead === 0) lastTiedInning = i + 1;
    // Detect go-ahead inning: the inning the winner went from
    // not-leading to leading and never gave it back.
    if (winnerLead <= 0 && newWinnerLead > 0) {
      goAheadInning = i + 1;
    }
    winnerLead = newWinnerLead;
  }

  // Late go-ahead: winner went ahead in the final inning of regulation
  // (or extras). This is the only case where we can honestly say "the
  // winning runs came late."
  if (
    goAheadInning != null &&
    margin <= 2 &&
    goAheadInning === innings &&
    innings >= 6
  ) {
    return `The winning run${margin === 1 ? "" : "s"} crossed in the ${ord(goAheadInning)}.`;
  }

  // Big inning: a single inning of 5+ runs that swung the score by a
  // visible margin. State the inning + how many runs.
  let bigInning: { inning: number; runs: number; team: string } | null = null;
  for (let i = 0; i < innings; i++) {
    const ar = a[i] ?? 0;
    const hr = h[i] ?? 0;
    if (ar >= 5) bigInning = { inning: i + 1, runs: ar, team: input.awayTeamName };
    if (hr >= 5 && hr > (bigInning?.runs ?? 0)) {
      bigInning = { inning: i + 1, runs: hr, team: input.homeTeamName };
    }
  }
  if (bigInning) {
    return `${bigInning.team} put up ${bigInning.runs} runs in the ${ord(bigInning.inning)}.`;
  }

  // Wire-to-wire winner: led from inning 1 onward, never tied after.
  if (firstWinnerLeadInning === 1 && leadFlips === 0 && lastTiedInning <= 0) {
    return `${winnerName} led from the first inning on.`;
  }

  // No specific story — leave it factual.
  return null;
}

function ord(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0] ?? "th");
}

function potgSentence(
  potg: { player_id: string; score: number; source: "batting" | "pitching" },
  batters: POTGBatterLine[],
  pitchers: POTGPitcherLine[],
  names: Record<string, string>,
): string {
  const name = names[potg.player_id] ?? potg.player_id;
  if (potg.source === "pitching") {
    const line = pitchers.find((p) => p.player_id === potg.player_id);
    if (line && line.ip_outs != null) {
      const ip = formatIP(line.ip_outs);
      const so = line.so ?? 0;
      const er = line.er ?? 0;
      if (er === 0) {
        return `${name} was untouchable on the mound, going ${ip} innings without giving up an earned run while striking out ${so}, and was named Player of the Game.`;
      }
      if (so >= 8) {
        return `${name} was the story of the day, mixing pitches and racking up ${so} strikeouts over ${ip} innings to take home Player of the Game honors.`;
      }
      return `${name} earned Player of the Game with a steady ${ip} innings on the mound, fanning ${so} hitters and surrendering only ${er} earned run${er === 1 ? "" : "s"}.`;
    }
    return `${name} earned Player of the Game with his work on the mound.`;
  }
  const line = batters.find((b) => b.player_id === potg.player_id);
  if (line) {
    const ab = line.ab ?? 0;
    const h = line.h ?? 0;
    const hr = line.hr ?? 0;
    const rbi = line.rbi ?? 0;
    const r = line.r ?? 0;
    const bb = line.bb ?? 0;

    // Build a natural prose sentence describing the day at the plate.
    const pieces: string[] = [];
    if (ab > 0 && h > 0) {
      pieces.push(`a ${h}-for-${ab} day at the plate`);
    } else if (ab > 0) {
      pieces.push(`${h}-for-${ab}`);
    }
    if (hr > 0) {
      pieces.push(
        `${hr === 1 ? "a home run" : `${hr} home runs`}`,
      );
    }
    if (rbi > 0) {
      pieces.push(`${rbi} RBI`);
    }
    if (r > 0) {
      pieces.push(`${r} run${r === 1 ? "" : "s"} scored`);
    }
    if (bb >= 2) {
      pieces.push(`${bb} walks`);
    }

    const detail = joinNatural(pieces);
    if (detail) {
      return `${name} was the offensive engine, putting together ${detail} to earn Player of the Game.`;
    }
    return `${name} was named Player of the Game for setting the tone offensively.`;
  }
  return `${name} earned Player of the Game.`;
}

// Join a list of phrases like ["a 3-for-4 day", "a home run", "4 RBI"]
// into "a 3-for-4 day, a home run, and 4 RBI" — Oxford comma, "and"
// before the last item. One element returns as-is.
function joinNatural(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function standoutBatters(
  batters: POTGBatterLine[],
  names: Record<string, string>,
  excludePlayerId?: string,
): string | null {
  const interesting = batters.filter(
    (b) =>
      b.player_id !== excludePlayerId &&
      ((b.hr ?? 0) > 0 ||
        (b.rbi ?? 0) >= 2 ||
        (b.h ?? 0) >= 2),
  );
  if (interesting.length === 0) return null;

  // Top 3 standouts only — keeps it readable.
  const top = interesting.slice(0, 3);
  const sentences = top.map((b) => {
    const name = names[b.player_id] ?? b.player_id;
    const ab = b.ab ?? 0;
    const h = b.h ?? 0;
    const hr = b.hr ?? 0;
    const rbi = b.rbi ?? 0;
    const r = b.r ?? 0;

    const pieces: string[] = [];
    if (h > 0) pieces.push(`went ${h}-for-${ab}`);
    if (hr > 0) {
      pieces.push(hr === 1 ? "added a home run" : `cracked ${hr} home runs`);
    }
    if (rbi >= 2) pieces.push(`drove in ${rbi}`);
    if (r >= 2 && rbi < 2) pieces.push(`scored ${r}`);

    if (pieces.length === 0) return `${name} contributed.`;
    return `${name} ${joinNatural(pieces)}.`;
  });

  if (sentences.length === 1) {
    return `${sentences[0]?.replace(/\.$/, "")} as well to keep the line moving.`;
  }
  return sentences.join(" ");
}

function pitchingParagraph(
  awayPitchers: POTGPitcherLine[],
  homePitchers: POTGPitcherLine[],
  names: Record<string, string>,
  winnerName: string | null,
): string | null {
  const winner =
    [...awayPitchers, ...homePitchers].find((p) => p.decision === "W") ?? null;
  const loser =
    [...awayPitchers, ...homePitchers].find((p) => p.decision === "L") ?? null;

  if (!winner && !loser) return null;

  const parts: string[] = [];
  if (winner && winner.ip_outs != null) {
    const wName = names[winner.player_id] ?? winner.player_id;
    const team = winnerName ? ` for ${winnerName}` : "";
    const ip = formatIP(winner.ip_outs);
    const so = winner.so ?? 0;
    const er = winner.er ?? 0;
    if (er === 0 && so >= 6) {
      parts.push(
        `On the mound, ${wName} was outstanding${team}, throwing a shutout over ${ip} innings and racking up ${so} strikeouts.`,
      );
    } else {
      parts.push(
        `${wName} picked up the win${team} after a solid ${ip} innings of work, striking out ${so} and giving up ${er} earned run${er === 1 ? "" : "s"}.`,
      );
    }
  }
  if (loser && loser.ip_outs != null) {
    const lName = names[loser.player_id] ?? loser.player_id;
    parts.push(
      `${lName} wore the loss, going ${formatIP(loser.ip_outs)} innings with ${loser.er ?? 0} earned run${(loser.er ?? 0) === 1 ? "" : "s"} charged to his line.`,
    );
  }
  return parts.join(" ");
}

// Replaced by linescoreBeat() in opener — kept stub here so existing
// callers compile while the recap pipeline is being simplified. Always
// returns null so no editorialized sentence is added.
function inningHighlight(_input: RecapInput): string | null {
  return null;
}

// Removed — the previous version added "statement win" / "building
// momentum" / "back to the drawing board" rhetoric that wasn't backed
// by data. Keep the function for callers; emit nothing.
function closingLine(
  _winnerName: string,
  _loserName: string,
  _margin: number,
): string {
  return "";
}

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  const suffix =
    suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0] ?? "th";
  return n + suffix;
}

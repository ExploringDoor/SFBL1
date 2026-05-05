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

  // If both sides are score-only, the recap is just the opener +
  // closing line — no player highlights at all. Note it explicitly
  // so the reader knows individual stats weren't recorded.
  if (input.awayScoreOnly && input.homeScoreOnly) {
    sentencesP2.length = 0;
    sentencesP2.push(
      "Score-only result — individual stats weren't recorded for either team.",
    );
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

  if (winnerName) {
    sentencesP2.push(closingLine(winnerName, loserName!, margin));
  }

  const body: string[] = [];
  if (sentencesP1.length > 0) body.push(sentencesP1.join(" "));
  if (sentencesP2.length > 0) body.push(sentencesP2.join(" "));

  return { headline, body, potg: potgWithName };
}

// ---------------------------------------------------------------------------

function winnerStyle(margin: number): string {
  if (margin >= 10) return "ran away from";
  if (margin >= 6) return "rolled past";
  if (margin >= 3) return "took down";
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
  const when = input.date
    ? ` on ${new Date(input.date).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })}`
    : "";

  if (winnerName == null) {
    return `The ${input.awayTeamName} and ${input.homeTeamName} battled to a ${input.awayScore}–${input.homeScore} tie${where}${when}.`;
  }

  if (margin >= 10) {
    return `${winnerName} dropped the hammer on ${loserName}${where}${when}, cruising to a ${winnerScore}–${loserScore} win behind a complete-team performance.`;
  }
  if (margin >= 6) {
    return `${winnerName} controlled the day from start to finish${where}${when}, beating ${loserName} ${winnerScore}–${loserScore} to keep their roll going.`;
  }
  if (margin >= 3) {
    return `${winnerName} grabbed momentum early and held on${where}${when}, defeating ${loserName} ${winnerScore}–${loserScore}.`;
  }
  if (margin === 1) {
    return `It came down to the final at-bat${where}${when}, with ${winnerName} edging ${loserName} ${winnerScore}–${loserScore} in a one-run thriller.`;
  }
  return `${winnerName} got past ${loserName} ${winnerScore}–${loserScore}${where}${when} in a tight battle.`;
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

function inningHighlight(input: RecapInput): string | null {
  const aLine = input.awayLine;
  const hLine = input.homeLine;
  if (!aLine || !hLine || aLine.length === 0) return null;

  // Find the inning with the biggest single-team scoring outburst.
  let biggest = { team: "", inn: -1, runs: 0 };
  for (let i = 0; i < aLine.length; i++) {
    const ar = aLine[i] ?? 0;
    const hr = hLine[i] ?? 0;
    if (ar > biggest.runs)
      biggest = { team: input.awayTeamName, inn: i + 1, runs: ar };
    if (hr > biggest.runs)
      biggest = { team: input.homeTeamName, inn: i + 1, runs: hr };
  }
  if (biggest.runs >= 4) {
    return `The ${biggest.team} broke things open with a ${biggest.runs}-run ${ordinal(biggest.inn)} inning that swung the momentum for good.`;
  }
  if (biggest.runs >= 3) {
    return `A ${biggest.runs}-run ${ordinal(biggest.inn)} inning by the ${biggest.team} was the difference.`;
  }
  return null;
}

function closingLine(
  winnerName: string,
  loserName: string,
  margin: number,
): string {
  if (margin >= 8) {
    return `Statement win for ${winnerName}; ${loserName} will be looking to bounce back next week.`;
  }
  if (margin >= 4) {
    return `${winnerName} keeps building momentum, while ${loserName} heads back to the drawing board.`;
  }
  return `Both clubs played them tough, but ${winnerName} found enough to come out on top.`;
}

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  const suffix =
    suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0] ?? "th";
  return n + suffix;
}

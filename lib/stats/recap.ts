// Auto-generated recap text from a box score. Pattern lifted from Long
// Beach's buildRealRecap helper per the Phase 3 scouting report.
//
// Output is plain text with explicit line breaks — no HTML. Server
// components can render <p> / <br /> as appropriate. Commissioners
// can later edit the generated recap into a richer story; this is the
// floor, not the ceiling.

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
  // Map of player_id → display name for prose.
  playerNames: Record<string, string>;
}

export interface RecapOutput {
  headline: string;
  body: string[]; // paragraphs
  potg: { player_id: string; player_name: string; score: number; source: "batting" | "pitching" } | null;
}

export function buildRecap(input: RecapInput): RecapOutput {
  const winner =
    input.homeScore > input.awayScore
      ? "home"
      : input.awayScore > input.homeScore
        ? "away"
        : "tie";

  const headline =
    winner === "tie"
      ? `${input.awayTeamName} and ${input.homeTeamName} played to a ${input.awayScore}–${input.homeScore} draw.`
      : winner === "home"
        ? `${input.homeTeamName} beat ${input.awayTeamName} ${input.homeScore}–${input.awayScore}.`
        : `${input.awayTeamName} beat ${input.homeTeamName} ${input.awayScore}–${input.homeScore}.`;

  const body: string[] = [];

  // POTG sentence.
  const allBatters = [...input.awayLineup, ...input.homeLineup];
  const allPitchers = [...input.awayPitchers, ...input.homePitchers];
  const potg = calcPOTG(allBatters, allPitchers);
  let potgWithName: RecapOutput["potg"] = null;
  if (potg) {
    const player_name = input.playerNames[potg.player_id] ?? potg.player_id;
    potgWithName = { ...potg, player_name };
    body.push(potgSentence(potg, allBatters, allPitchers, input.playerNames));
  }

  // Standout batters: anyone with a HR or 3+ RBI.
  const standouts = standoutBatters(allBatters, input.playerNames);
  if (standouts) body.push(standouts);

  // Pitching line for the winning starter (if there is one).
  const pitcherLine = winningPitcherLine(allPitchers, input.playerNames);
  if (pitcherLine) body.push(pitcherLine);

  return { headline, body, potg: potgWithName };
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
      return `${name} earned Player of the Game with ${formatIP(line.ip_outs)} IP, ${line.so ?? 0} strikeouts and ${line.er ?? 0} ER.`;
    }
    return `${name} earned Player of the Game on the mound.`;
  }
  const line = batters.find((b) => b.player_id === potg.player_id);
  if (line) {
    const parts: string[] = [];
    if ((line.h ?? 0) > 0) parts.push(`${line.h}-for-${line.ab ?? 0}`);
    if ((line.hr ?? 0) > 0)
      parts.push(`${line.hr} home run${(line.hr ?? 0) === 1 ? "" : "s"}`);
    if ((line.rbi ?? 0) > 0) parts.push(`${line.rbi} RBI`);
    const detail = parts.length ? " — " + parts.join(", ") : "";
    return `${name} earned Player of the Game${detail}.`;
  }
  return `${name} earned Player of the Game.`;
}

function standoutBatters(
  batters: POTGBatterLine[],
  names: Record<string, string>,
): string | null {
  const interesting = batters.filter(
    (b) => (b.hr ?? 0) > 0 || (b.rbi ?? 0) >= 3,
  );
  if (interesting.length === 0) return null;
  const phrases = interesting.map((b) => {
    const name = names[b.player_id] ?? b.player_id;
    const hrPart =
      (b.hr ?? 0) > 0
        ? `${b.hr} HR`
        : "";
    const rbiPart = (b.rbi ?? 0) >= 3 ? `${b.rbi} RBI` : "";
    const both = [hrPart, rbiPart].filter(Boolean).join(", ");
    return `${name} (${both})`;
  });
  return `Notable performances: ${phrases.join("; ")}.`;
}

function winningPitcherLine(
  pitchers: POTGPitcherLine[],
  names: Record<string, string>,
): string | null {
  const winner = pitchers.find((p) => p.decision === "W");
  if (!winner || !winner.ip_outs) return null;
  const name = names[winner.player_id] ?? winner.player_id;
  return `${name} got the win, going ${formatIP(winner.ip_outs)} IP with ${winner.so ?? 0} strikeouts and ${winner.er ?? 0} earned runs.`;
}

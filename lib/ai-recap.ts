// Short game recap for STATS-OFF leagues (e.g. COYBL). These leagues
// record only a final score — no box score, no player lines — so the
// game modal shows a brief narrative instead of a linescore.
//
// Two tiers:
//   1. generateAiRecap() — an AI-written 2-3 sentence recap via the
//      Anthropic API. Same raw-fetch pattern + env vars as
//      app/api/parse-boxscore/route.ts (ANTHROPIC_API_KEY /
//      ANTHROPIC_MODEL). Returns null when no key is configured or on
//      any error/timeout, so callers fall back gracefully.
//   2. shortTemplateRecap() — a deterministic template recap that needs
//      no API key. Always available; used as the fallback.
//
// IMPORTANT: stats-off games have ONLY the score. The AI prompt forbids
// inventing players, innings, or stats — the recap sticks to teams,
// score, date, and age group.

import { formatGameDate } from "@/lib/format-time";

export interface ShortRecapInput {
  awayName: string;
  homeName: string;
  awayScore: number;
  homeScore: number;
  date: string | null;
  ageGroup?: string | null;
  leagueName?: string | null;
}

// Audit L9 (mirrors parse-boxscore): keep the model id overridable via
// env so it can roll forward without a code deploy.
const ANTHROPIC_MODEL: string =
  process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";

function winnerLoser(i: ShortRecapInput) {
  const awayWon = i.awayScore > i.homeScore;
  return {
    tie: i.awayScore === i.homeScore,
    winner: awayWon ? i.awayName : i.homeName,
    loser: awayWon ? i.homeName : i.awayName,
    hi: Math.max(i.awayScore, i.homeScore),
    lo: Math.min(i.awayScore, i.homeScore),
  };
}

/** Deterministic short recap — no API key required. */
export function shortTemplateRecap(i: ShortRecapInput): string {
  const { tie, winner, loser, hi, lo } = winnerLoser(i);
  const when = i.date
    ? formatGameDate(i.date, null, { month: "long", day: "numeric" })
    : null;
  const age = i.ageGroup ? `${i.ageGroup} ` : "";

  if (tie) {
    return `${i.awayName} and ${i.homeName} battled to a ${i.awayScore}–${i.homeScore} tie${when ? ` on ${when}` : ""} in ${age}action.`;
  }

  const margin = hi - lo;
  const verb = margin >= 8 ? "rolled past" : margin >= 4 ? "beat" : "edged";
  const closer =
    margin >= 8
      ? `A dominant, all-around effort from ${winner}.`
      : margin === 1
        ? `${winner} held on for a one-run win.`
        : `${loser} kept it close but couldn't complete the comeback.`;
  return `${winner} ${verb} ${loser} ${hi}–${lo}${when ? ` on ${when}` : ""} in ${age}play. ${closer}`;
}

/** AI-written short recap. Returns null when unavailable (no key, error,
 *  or timeout) so the caller can fall back to shortTemplateRecap(). */
export async function generateAiRecap(
  i: ShortRecapInput,
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const { tie, winner, loser, hi, lo } = winnerLoser(i);
  const result = tie
    ? `${i.awayName} ${i.awayScore}, ${i.homeName} ${i.homeScore} (final was a tie)`
    : `${winner} defeated ${loser} ${hi}–${lo}`;
  const when = i.date
    ? formatGameDate(i.date, null, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : null;

  const prompt = [
    `Write a short recap of a youth baseball game for a league website.`,
    ``,
    `League: ${i.leagueName ?? "youth baseball league"}${i.ageGroup ? ` (${i.ageGroup} division)` : ""}.`,
    `Result: ${result}${when ? ` on ${when}` : ""}.`,
    ``,
    `Requirements:`,
    `- 2 to 3 sentences, under 55 words total.`,
    `- Use ONLY the facts above (team names, final score, date, age group). Do NOT invent player names, innings, hits, plays, or any statistics — none are available.`,
    `- Warm, family-friendly, encouraging tone appropriate for a kids' league.`,
    `- Output the paragraph only: no headline, no markdown, no quotation marks.`,
  ].join("\n");

  // Hard timeout so a slow API call never hangs the game modal render.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 220,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = Array.isArray(json.content)
      ? json.content
          .filter((b) => b?.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("")
          .trim()
      : "";
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// /api/parse-boxscore — captain uploads a PDF or photo of their
// scorebook; we send it to Claude's vision API and return parsed
// per-batter / per-pitcher / linescore JSON. Captain reviews +
// submits via the existing box-score flow.
//
// Ported from DVSL ~/Desktop/softball-site/api/parse-boxscore.js
// (Vercel serverless). Same prompt shape, same model.
//
// Two upload modes:
//   - pdfBase64 → sent to Claude as a `document` block. Preserves
//     visual table structure (Excel-exported PDFs from GameChanger
//     keep their column alignment, so per-batter rows parse back
//     reliably).
//   - imageBase64 + imageType → `image` block with vision.
// Plus a `text` fallback for callers that pre-extracted via pdfjs.
//
// Auth: any signed-in captain or admin of the league. The endpoint
// just runs OCR — it doesn't write to Firestore. The captain submits
// the parsed payload through the normal /api/captain-submit flow.
//
// Env var ANTHROPIC_API_KEY required. If missing, returns a
// reasonable error so the captain knows to fall back to manual entry.

import { NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/firebase-admin";

export const runtime = "nodejs";
// Box-score parsing tops out around 30s for a 9-inning baseball game
// with 30+ batters per side. Set a generous max so Vercel doesn't
// kill the function mid-Claude-call.
export const maxDuration = 60;

interface Body {
  leagueId?: unknown;
  gameId?: unknown;
  awayTeam?: unknown;
  homeTeam?: unknown;
  date?: unknown;
  week?: unknown;
  field?: unknown;
  text?: unknown;
  imageBase64?: unknown;
  imageType?: unknown;
  pdfBase64?: unknown;
}

export async function POST(req: Request) {
  const authHdr = req.headers.get("authorization");
  if (!authHdr?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing bearer token" },
      { status: 401 },
    );
  }
  const idToken = authHdr.slice("Bearer ".length).trim();

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400 },
    );
  }
  const claim = (decoded.leagues as Record<string, string> | undefined)?.[
    leagueId
  ];
  const isAuthorized =
    claim === "admin" ||
    (typeof claim === "string" && claim.startsWith("captain:"));
  if (!isAuthorized) {
    return NextResponse.json(
      { error: "Captain or admin claim required" },
      { status: 403 },
    );
  }

  const text = typeof body.text === "string" ? body.text : null;
  const pdfBase64 =
    typeof body.pdfBase64 === "string" ? body.pdfBase64 : null;
  const imageBase64 =
    typeof body.imageBase64 === "string" ? body.imageBase64 : null;
  const imageType =
    typeof body.imageType === "string" ? body.imageType : "image/jpeg";

  if (!text && !pdfBase64 && !imageBase64) {
    return NextResponse.json(
      { error: "Provide one of: pdfBase64, imageBase64, or text." },
      { status: 400 },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "ANTHROPIC_API_KEY isn't configured for this environment. " +
          "Captain can fall back to manual entry — paste the scores " +
          "into the box-score editor or use Quick Score.",
      },
      { status: 501 },
    );
  }

  const awayTeam = String(body.awayTeam ?? "");
  const homeTeam = String(body.homeTeam ?? "");
  const date = String(body.date ?? "");
  const week = String(body.week ?? "");
  const field = String(body.field ?? "");

  const prompt = `You are parsing a baseball/softball box score. Extract ALL data and return ONLY valid JSON, no other text.

Game info:
- Away Team: ${awayTeam}
- Home Team: ${homeTeam}
- Date: ${date}
- Week: ${week}
- Field: ${field}

Return this exact JSON structure:
{
  "awayScore": <number>,
  "homeScore": <number>,
  "awayBatters": [{"name":"","num":"","pos":"","ab":0,"r":0,"h":0,"rbi":0,"bb":0,"so":0,"hr":0,"doubles":0,"triples":0,"sb":0}],
  "homeBatters": [<same shape>],
  "awayPitchers": [{"name":"","num":"","ip":"","h":0,"r":0,"er":0,"bb":0,"so":0,"hr":0,"decision":""}],
  "homePitchers": [<same shape>],
  "linescore": {
    "away": [<inning 1 runs>, <inning 2>, ...],
    "home": [<inning 1 runs>, <inning 2>, ...],
    "awayErrors": 0,
    "homeErrors": 0
  }
}

Rules:
- Names may be truncated — do your best.
- Missing stats default to 0.
- decision is "W" / "L" / "S" or empty.
- IP is a string like "6.1" (6 1/3 innings).
- Return ONLY the JSON, no markdown fences, no surrounding text.`;

  // Build the message content. Three modes (matching DVSL):
  //   1. PDF: `document` block, preserves table structure for
  //      Excel-exported scoresheets / GameChanger PDFs.
  //   2. Image: `image` block, uses Claude vision.
  //   3. Plain text: backward-compat for old callers.
  type AnthropicBlock =
    | { type: "text"; text: string }
    | {
        type: "image";
        source: { type: "base64"; media_type: string; data: string };
      }
    | {
        type: "document";
        source: { type: "base64"; media_type: string; data: string };
      };
  let messageContent: string | AnthropicBlock[];
  if (pdfBase64) {
    messageContent = [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: pdfBase64,
        },
      },
      { type: "text", text: prompt },
    ];
  } else if (imageBase64) {
    messageContent = [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: imageType,
          data: imageBase64,
        },
      },
      { type: "text", text: prompt },
    ];
  } else {
    messageContent = `${prompt}\n\nBox score text:\n${text}`;
  }

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [{ role: "user", content: messageContent }],
      }),
    });
    const claudeData = (await claudeRes.json()) as {
      content?: { text?: string }[];
      error?: { message?: string };
    };
    if (!claudeRes.ok) {
      return NextResponse.json(
        {
          error: `Claude API error: ${
            claudeData.error?.message ?? `HTTP ${claudeRes.status}`
          }`,
        },
        { status: 502 },
      );
    }
    const rawText = claudeData.content?.[0]?.text?.trim() ?? "";
    if (!rawText) {
      return NextResponse.json(
        { error: "Claude returned empty content" },
        { status: 502 },
      );
    }
    const jsonText = rawText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      return NextResponse.json(
        {
          error: "Couldn't parse Claude's response as JSON.",
          raw_preview: jsonText.slice(0, 200),
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      parsed,
      gameId: body.gameId,
      meta: { awayTeam, homeTeam, date, week, field },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "OCR failed",
      },
      { status: 500 },
    );
  }
}

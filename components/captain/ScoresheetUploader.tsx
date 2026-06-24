"use client";

// Scoresheet uploader — DVSL parity for "snap a photo or upload
// PDF, AI parses it." Captain picks a PDF (e.g. GameChanger export)
// or photo of their paper scoresheet; we POST it to
// /api/parse-boxscore which calls Claude vision; parsed JSON comes
// back with awayScore/homeScore + per-batter + per-pitcher +
// linescore. The parent component populates its existing editor
// state from the parsed data and the captain reviews + submits.
//
// Per DVSL captain.html:5210 — sending the raw PDF (not pdfjs-
// extracted text) preserves table structure so Excel-exported
// rosters parse cleanly.

import { useState } from "react";
import type { User } from "firebase/auth";

export interface ParsedBoxScore {
  awayScore: number | null;
  homeScore: number | null;
  awayBatters: ParsedBatter[];
  homeBatters: ParsedBatter[];
  awayPitchers: ParsedPitcher[];
  homePitchers: ParsedPitcher[];
  linescore: {
    away: number[];
    home: number[];
    awayErrors: number;
    homeErrors: number;
  };
}

export interface ParsedBatter {
  name: string;
  num: string;
  pos: string;
  ab: number;
  r: number;
  h: number;
  rbi: number;
  bb: number;
  so: number;
  hr: number;
  doubles: number;
  triples: number;
  sb?: number;
}

export interface ParsedPitcher {
  name: string;
  num: string;
  ip: string;
  h: number;
  r: number;
  er: number;
  bb: number;
  so: number;
  hr?: number;
  decision: string;
}

interface Props {
  leagueId: string;
  gameId: string;
  awayTeam: string;
  homeTeam: string;
  date: string;
  field: string;
  user: User | null;
  onParsed: (parsed: ParsedBoxScore) => void;
}

export function ScoresheetUploader({
  leagueId,
  gameId,
  awayTeam,
  homeTeam,
  date,
  field,
  user,
  onParsed,
}: Props) {
  const [stage, setStage] = useState<
    | { kind: "idle" }
    | { kind: "reading"; fileName: string }
    | { kind: "uploading"; fileName: string }
    | { kind: "parsing"; fileName: string }
    | { kind: "ok"; summary: string }
    | { kind: "err"; message: string }
  >({ kind: "idle" });

  async function handleFile(file: File) {
    if (!user) {
      setStage({ kind: "err", message: "Sign in first." });
      return;
    }
    if (file.size > 8_000_000) {
      setStage({
        kind: "err",
        message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Keep it under 8 MB. PDFs and JPGs from a phone are usually well under.`,
      });
      return;
    }

    setStage({ kind: "reading", fileName: file.name });
    const isPdf = file.type === "application/pdf";
    const isImage = file.type.startsWith("image/");
    if (!isPdf && !isImage) {
      setStage({
        kind: "err",
        message: "Pick a PDF or an image (JPG / PNG / HEIC).",
      });
      return;
    }
    let base64: string;
    try {
      base64 = await readFileAsBase64(file);
    } catch (e) {
      setStage({
        kind: "err",
        message:
          "Couldn't read the file. Try again or pick a different file.",
      });
      return;
    }

    setStage({ kind: "uploading", fileName: file.name });
    const idToken = await user.getIdToken();
    const payload: Record<string, unknown> = {
      leagueId,
      gameId,
      awayTeam,
      homeTeam,
      date,
      field,
    };
    if (isPdf) {
      payload.pdfBase64 = base64;
    } else {
      payload.imageBase64 = base64;
      payload.imageType = file.type;
    }

    setStage({ kind: "parsing", fileName: file.name });
    try {
      const res = await fetch("/api/parse-boxscore", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        parsed?: ParsedBoxScore;
        warnings?: string[];
        error?: string;
      };
      if (!res.ok || !data.ok || !data.parsed) {
        setStage({
          kind: "err",
          message: data.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      const p = data.parsed;
      const aB = p.awayBatters?.length ?? 0;
      const hB = p.homeBatters?.length ?? 0;
      // The parser flags (doesn't reject) batting lines where the OCR'd
      // H is less than 2B+3B+HR — an impossible line that, left in,
      // would crash the league stat recalc. Append the flags to the
      // summary so the captain fixes those rows before submitting.
      const warnNote =
        data.warnings && data.warnings.length > 0
          ? ` ⚠️ Check these lines (likely a misread): ${data.warnings.join("; ")}`
          : "";
      setStage({
        kind: "ok",
        summary:
          (aB + hB > 0
            ? `Parsed: final score ${p.awayScore ?? "?"}–${p.homeScore ?? "?"}, ${aB + hB} batters total. Review below and edit if needed.`
            : `Parsed final score ${p.awayScore ?? "?"}–${p.homeScore ?? "?"}. No per-batter detail extracted.`) +
          warnNote,
      });
      onParsed(p);
    } catch (e) {
      setStage({
        kind: "err",
        message: e instanceof Error ? e.message : "Parse failed",
      });
    }
  }

  return (
    <div className="ssu-card">
      <div className="ssu-head">
        <div>
          <p className="ssu-title">📄 Upload scoresheet (instead of typing)</p>
          <p className="ssu-sub">
            PDF (e.g. GameChanger export) or photo of your paper sheet —
            AI reads it and pre-fills the editor below. You review +
            submit. Faster than typing names.
          </p>
        </div>
      </div>

      <div className="ssu-actions">
        <label className="ssu-btn ssu-btn-primary">
          📁 Choose file
          <input
            type="file"
            accept=".pdf,application/pdf,image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.currentTarget.value = "";
            }}
            disabled={
              stage.kind === "reading" ||
              stage.kind === "uploading" ||
              stage.kind === "parsing"
            }
          />
        </label>
        <span className="ssu-formats">PDF · JPG · PNG · HEIC</span>
      </div>

      {(stage.kind === "reading" ||
        stage.kind === "uploading" ||
        stage.kind === "parsing") && (
        <div className="ssu-progress">
          <div
            className="ssu-bar"
            style={{
              width:
                stage.kind === "reading"
                  ? "20%"
                  : stage.kind === "uploading"
                    ? "55%"
                    : "85%",
            }}
          />
          <span>
            {stage.kind === "reading"
              ? "Reading file…"
              : stage.kind === "uploading"
                ? "Uploading…"
                : "AI is reading the scoresheet…"}
          </span>
        </div>
      )}

      {stage.kind === "ok" && <p className="ssu-ok">✓ {stage.summary}</p>}

      {stage.kind === "err" && (
        <p className="ssu-err">⚠ {stage.message}</p>
      )}

      <style jsx>{`
        .ssu-card {
          margin: 12px 28px 24px;
          padding: 16px 20px;
          background: linear-gradient(
            135deg,
            rgba(16, 185, 129, 0.06),
            rgba(59, 130, 246, 0.04)
          );
          border: 1px solid #cbd5e1;
          border-radius: 12px;
        }
        .ssu-title {
          font-size: 15px;
          font-weight: 700;
          color: #0f172a;
          margin: 0;
        }
        .ssu-sub {
          font-size: 13px;
          color: #475569;
          margin: 4px 0 0;
          line-height: 1.5;
        }
        .ssu-actions {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 12px;
        }
        .ssu-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 10px 18px;
          border-radius: 8px;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
          border: none;
          font-family: inherit;
        }
        .ssu-btn-primary {
          background: var(--brand-primary, #002d72);
          color: white;
        }
        .ssu-btn-primary:hover {
          filter: brightness(1.1);
        }
        .ssu-formats {
          font-size: 11px;
          color: #94a3b8;
          letter-spacing: 0.04em;
          font-weight: 600;
          text-transform: uppercase;
        }
        .ssu-progress {
          margin-top: 12px;
          background: #e2e8f0;
          border-radius: 999px;
          height: 8px;
          position: relative;
          overflow: hidden;
        }
        .ssu-progress span {
          position: absolute;
          left: 0;
          right: 0;
          top: 14px;
          font-size: 12px;
          color: #475569;
          font-weight: 600;
        }
        .ssu-bar {
          background: linear-gradient(90deg, #10b981, #3b82f6);
          height: 100%;
          transition: width 0.3s ease;
          border-radius: 999px;
        }
        .ssu-ok {
          margin-top: 28px;
          font-size: 13px;
          color: #065f46;
          font-weight: 600;
        }
        .ssu-err {
          margin-top: 12px;
          font-size: 13px;
          color: #991b1b;
          background: #fef2f2;
          padding: 8px 12px;
          border-radius: 6px;
          border: 1px solid #fecaca;
        }
      `}</style>
    </div>
  );
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        // result format: "data:application/pdf;base64,<base64-payload>"
        // Strip the prefix to get just the base64 payload, matching
        // what Anthropic's API expects.
        const idx = result.indexOf(",");
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      } else {
        reject(new Error("Reader returned non-string"));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

"use client";

// Single-game inline Quick Score form. Expands right under a game in
// the Submit Score list — just that ONE game, on the same page (Adam,
// 2026-06: no separate all-games view, no box-score page). Score-only
// submission via /api/captain-submit; admin reconciles. Maps Us/Them
// to away/home based on which side the captain's team is on.
//
// After the score saves, the confirmation offers an OPTIONAL game
// summary (Nelson, 2026-07: "managers can write a little summary of the
// game afterwards"). The recap plumbing already existed — /api/game-recap
// accepts a recap from a captain playing in the game and the public game
// page renders it in place of the auto-generated one — but the only entry
// point was an "Edit recap" button buried on the game page, which no
// manager would ever find. This surfaces it at the one moment they're
// already thinking about the game. Skippable; never blocks the score.

import { useState } from "react";
import { useUser } from "@/lib/auth-client";

interface Game {
  id: string;
  away_team_id: string;
  home_team_id: string;
}

export function QuickScoreInline({
  leagueId,
  teamId,
  game,
  oppName,
  onClose,
}: {
  leagueId: string;
  teamId: string;
  game: Game;
  oppName: string;
  onClose?: () => void;
}) {
  const user = useUser();
  const [us, setUs] = useState("");
  const [them, setThem] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optional post-score game summary (recap override).
  const [summary, setSummary] = useState("");
  const [sumSaving, setSumSaving] = useState(false);
  const [sumSaved, setSumSaved] = useState(false);
  const [sumError, setSumError] = useState<string | null>(null);

  // /api/game-recap caps the stored markdown at 8KB; keep the box well
  // under that so a manager never hits a server-side rejection.
  const SUMMARY_MAX = 4000;

  async function submit() {
    if (!user) {
      setError("Not signed in.");
      return;
    }
    const u = Number(us);
    const t = Number(them);
    if (us === "" || them === "" || !Number.isFinite(u) || !Number.isFinite(t)) {
      setError("Enter both scores.");
      return;
    }
    if (u < 0 || t < 0) {
      setError("Scores can't be negative.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      // Us = my team's score; map to away/home by which side I'm on.
      const isAway = game.away_team_id === teamId;
      const res = await fetch("/api/captain-submit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          gameId: game.id,
          score_only: true,
          final_score: u,
          opp_score_only: true,
          opp_side: isAway ? "home" : "away",
          opp_final_score: t,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveSummary() {
    if (!user) {
      setSumError("Not signed in.");
      return;
    }
    const text = summary.trim();
    if (!text) {
      setSumError("Write a few words first.");
      return;
    }
    setSumSaving(true);
    setSumError(null);
    try {
      const idToken = await user.getIdToken();
      // Same endpoint the game page's "Edit recap" uses. It re-checks
      // that we're a captain in THIS game before storing.
      const res = await fetch("/api/game-recap", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          gameId: game.id,
          markdown: text,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setSumError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSumSaved(true);
    } catch (e) {
      setSumError(e instanceof Error ? e.message : "Couldn't post the summary");
    } finally {
      setSumSaving(false);
    }
  }

  const box: React.CSSProperties = {
    border: "1px solid rgba(0, 45, 114, 0.2)",
    borderLeft: "4px solid var(--brand-primary, #002d72)",
    borderRadius: 10,
    background: "rgba(0, 45, 114, 0.03)",
    padding: "14px 16px",
    margin: "2px 0 10px",
  };

  if (saved) {
    return (
      <div style={{ ...box, borderLeftColor: "#16a34a" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#15803d" }}>
          ✓ Final score submitted{us && them ? ` (${us}–${them})` : ""}.
        </span>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
          The league office will confirm it.
        </p>

        {sumSaved ? (
          <p
            style={{
              margin: "12px 0 0",
              fontSize: 13.5,
              fontWeight: 600,
              color: "#15803d",
            }}
          >
            ✓ Summary posted — it&apos;s on the game page now.
          </p>
        ) : (
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px dashed rgba(0,0,0,0.15)",
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--text-strong)",
              }}
            >
              Add a game summary{" "}
              <span style={{ fontWeight: 500, color: "var(--muted)" }}>
                (optional)
              </span>
            </div>
            <p
              style={{
                margin: "3px 0 8px",
                fontSize: 12.5,
                lineHeight: 1.5,
                color: "var(--muted)",
              }}
            >
              A few lines on how it went — big hits, who pitched, the turning
              point. It shows on the game page in place of the auto-written
              recap.
            </p>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value.slice(0, SUMMARY_MAX))}
              disabled={sumSaving}
              rows={4}
              placeholder={`How did it go vs ${oppName}?`}
              style={{
                width: "100%",
                padding: "9px 11px",
                border: "1px solid rgba(0,0,0,0.2)",
                borderRadius: 8,
                fontSize: 14,
                lineHeight: 1.5,
                fontFamily: "inherit",
                resize: "vertical",
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 8,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {summary.length}/{SUMMARY_MAX}
              </span>
              <button
                type="button"
                onClick={saveSummary}
                disabled={sumSaving || !summary.trim()}
                className="le-cap-btn-primary"
                style={{
                  marginLeft: "auto",
                  opacity: sumSaving || !summary.trim() ? 0.6 : 1,
                }}
              >
                {sumSaving ? "Posting…" : "Post summary"}
              </button>
            </div>
            {sumError && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  color: "#b91c1c",
                  fontWeight: 600,
                }}
              >
                {sumError}
              </div>
            )}
          </div>
        )}

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="le-cap-btn-secondary"
            style={{ marginTop: 12 }}
          >
            Done
          </button>
        )}
      </div>
    );
  }

  const input: React.CSSProperties = {
    width: 64,
    padding: "8px 10px",
    border: "1px solid rgba(0,0,0,0.2)",
    borderRadius: 8,
    fontSize: 18,
    fontWeight: 700,
    textAlign: "center",
  };
  const lbl: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--muted)",
    alignItems: "center",
  };

  return (
    <div style={box}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "var(--text-strong)",
          marginBottom: 10,
        }}
      >
        Final score vs {oppName}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <label style={lbl}>
          <span>Us</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={us}
            placeholder="0"
            onChange={(e) => setUs(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            disabled={saving}
            style={input}
          />
        </label>
        <span style={{ fontSize: 22, color: "var(--muted)", paddingBottom: 8 }}>–</span>
        <label style={lbl}>
          <span>Them</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={them}
            placeholder="0"
            onChange={(e) => setThem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            disabled={saving}
            style={input}
          />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="le-cap-btn-primary"
          style={{ marginLeft: "auto", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Submitting…" : "Submit"}
        </button>
      </div>
      {error && (
        <div
          style={{
            marginTop: 10,
            fontSize: 13,
            color: "#b91c1c",
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

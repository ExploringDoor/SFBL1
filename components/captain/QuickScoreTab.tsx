"use client";

// Captain "Quick Score" tab — dead-simple score-only submission.
//
// One row per game. Two number inputs (Us / Them). Submit. Done.
// No lineup, no batters, no pitchers, no per-inning linescore. The
// public box-score page renders "—" across innings + a "Final score
// only — no individual stats" placeholder when score_only is set.
//
// Different from the existing "Submit Score" tab (which links to
// /captain/box-score for full lineup + stats entry) and the
// captain box-score page's "score-only" toggle (which is buried
// inside the full editor).

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useUser } from "@/lib/auth-client";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { formatTime12, parseGameDate } from "@/lib/format-time";

interface Game {
  id: string;
  date: string;
  time: string;
  field: string;
  away_team_id: string;
  home_team_id: string;
  status: string;
}

interface Props {
  leagueId: string;
  teamId: string;
  teamNamesById: Record<string, string>;
}

export function QuickScoreTab({ leagueId, teamId, teamNamesById }: Props) {
  const user = useUser();
  const [games, setGames] = useState<Game[]>([]);
  const [drafts, setDrafts] = useState<
    Record<string, { us: string; them: string }>
  >({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const db = getDb();
      const snap = await getDocs(collection(db, `leagues/${leagueId}/games`));
      // Filter to games that involve this captain's team and aren't
      // already final/cancelled. Sort newest first so today's game is
      // at the top.
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setGames(
        snap.docs
          .map((d): Game => {
            const data = d.data();
            const rawDate = String(data.date ?? "");
            return {
              id: d.id,
              date: /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
                ? rawDate
                : rawDate.slice(0, 10),
              time: String(data.time ?? ""),
              field: String(data.field ?? ""),
              away_team_id: String(data.away_team_id ?? ""),
              home_team_id: String(data.home_team_id ?? ""),
              status: String(data.status ?? "scheduled"),
            };
          })
          .filter(
            (g) =>
              (g.away_team_id === teamId || g.home_team_id === teamId) &&
              g.status !== "cancelled" &&
              g.status !== "draft",
          )
          .sort((a, b) => {
            // Past games first (most recent), then upcoming.
            // Audit M16: parseGameDate handles both date-only and
            // combined-ISO storage (the old `${date}T12:00:00`
            // concat produced an Invalid Date → NaN sort for any
            // combined-ISO value). NaN → 0 fallback keeps it stable.
            const ad = parseGameDate(a.date, a.time)?.getTime() ?? 0;
            const bd = parseGameDate(b.date, b.time)?.getTime() ?? 0;
            const tNow = today.getTime();
            const aPast = ad <= tNow;
            const bPast = bd <= tNow;
            if (aPast !== bPast) return aPast ? -1 : 1;
            return aPast ? bd - ad : ad - bd;
          }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load games");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, teamId]);

  function setDraft(gameId: string, side: "us" | "them", value: string) {
    setDrafts((cur) => ({
      ...cur,
      [gameId]: {
        us: side === "us" ? value : (cur[gameId]?.us ?? ""),
        them: side === "them" ? value : (cur[gameId]?.them ?? ""),
      },
    }));
  }

  async function submit(g: Game) {
    if (!user) {
      setError("Not signed in");
      return;
    }
    const draft = drafts[g.id];
    const us = draft?.us !== undefined ? Number(draft.us) : NaN;
    const them = draft?.them !== undefined ? Number(draft.them) : NaN;
    if (!Number.isFinite(us) || !Number.isFinite(them)) {
      setError("Enter both scores before submitting.");
      return;
    }
    if (us < 0 || them < 0) {
      setError("Scores can't be negative.");
      return;
    }
    setSavingId(g.id);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      // Map Us / Them → away / home based on which side the captain's
      // team is on. captain-submit derives `side` from the captain's
      // claim, then reads `final_score` for that side. We also send
      // `opp_final_score` so the OTHER team's score lands on the same
      // submission (so admin doesn't need both captains to submit).
      const isAway = g.away_team_id === teamId;
      const myScore = us;
      const oppScore = them;
      const oppSide = isAway ? "home" : "away";
      const res = await fetch("/api/captain-submit", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          gameId: g.id,
          score_only: true,
          final_score: myScore,
          opp_score_only: true,
          opp_side: oppSide,
          opp_final_score: oppScore,
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
      setSavedIds((cur) => new Set([...cur, g.id]));
      setDrafts((cur) => {
        const next = { ...cur };
        delete next[g.id];
        return next;
      });
      // Refresh list so the row's status flips to "final" (or stays
      // pending until admin reconciles, depending on opposing
      // captain's submission state).
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return (
      <div className="cap-tab">
        <div className="cap-section-head">
          <h2 className="cap-section-title">⚡ Quick Score</h2>
        </div>
        <p>Loading games…</p>
      </div>
    );
  }

  return (
    <div className="cap-tab">
      <div className="cap-section-head">
        <h2 className="cap-section-title">⚡ Quick Score</h2>
        <p className="cap-section-sub">
          Just the final score. No lineup, no per-inning, no per-batter.
          Both captains can submit; admin reconciles if you disagree.
          For full box scores with stats, use <strong>Submit Score</strong>{" "}
          instead.
        </p>
      </div>

      {error && (
        <div className="cap-error-banner" role="alert">
          {error}
        </div>
      )}

      {games.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          No games to score yet.
        </p>
      ) : (
        <div className="qs-grid">
          {games.map((g) => {
            const isAway = g.away_team_id === teamId;
            const oppId = isAway ? g.home_team_id : g.away_team_id;
            const oppName = teamNamesById[oppId] ?? oppId;
            const isFinal = g.status === "final" || g.status === "approved";
            const wasJustSubmitted = savedIds.has(g.id);
            return (
              <div
                key={g.id}
                className={
                  "qs-row" +
                  (isFinal ? " qs-row-final" : "") +
                  (wasJustSubmitted ? " qs-row-saved" : "")
                }
              >
                <div className="qs-meta">
                  <div className="qs-date">
                    {formatDate(g.date)}
                    {g.time ? ` · ${formatTime12(g.time)}` : ""}
                  </div>
                  <div className="qs-matchup">
                    {isAway ? "Away @ " : "Home vs "}
                    <strong>{oppName}</strong>
                  </div>
                  {g.field && <div className="qs-field">{g.field}</div>}
                </div>

                <div className="qs-inputs">
                  <label>
                    <span>Us</span>
                    <input
                      type="number"
                      min={0}
                      value={drafts[g.id]?.us ?? ""}
                      onChange={(e) => setDraft(g.id, "us", e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submit(g);
                      }}
                      disabled={savingId === g.id}
                      placeholder="0"
                    />
                  </label>
                  <span className="qs-dash">–</span>
                  <label>
                    <span>Them</span>
                    <input
                      type="number"
                      min={0}
                      value={drafts[g.id]?.them ?? ""}
                      onChange={(e) =>
                        setDraft(g.id, "them", e.target.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submit(g);
                      }}
                      disabled={savingId === g.id}
                      placeholder="0"
                    />
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() => submit(g)}
                  disabled={
                    savingId === g.id ||
                    !drafts[g.id]?.us ||
                    !drafts[g.id]?.them
                  }
                  className="qs-submit"
                >
                  {savingId === g.id
                    ? "Submitting…"
                    : wasJustSubmitted
                      ? "✓ Submitted"
                      : "Submit"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <style jsx>{`
        .qs-grid {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .qs-row {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 16px;
          align-items: center;
          padding: 14px 16px;
          background: white;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          transition: all 0.15s;
        }
        .qs-row:hover {
          border-color: #94a3b8;
        }
        .qs-row-final {
          background: #f8fafc;
          opacity: 0.7;
        }
        .qs-row-saved {
          border-color: #10b981;
          background: #ecfdf5;
        }
        .qs-meta {
          min-width: 0;
        }
        .qs-date {
          font-size: 11px;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          font-weight: 600;
        }
        .qs-matchup {
          font-size: 16px;
          color: #0f172a;
          margin-top: 2px;
        }
        .qs-field {
          font-size: 12px;
          color: #64748b;
          margin-top: 2px;
        }
        .qs-inputs {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .qs-inputs label {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }
        .qs-inputs label span {
          font-size: 10px;
          color: #64748b;
          text-transform: uppercase;
          font-weight: 700;
          letter-spacing: 0.04em;
        }
        .qs-inputs input {
          width: 64px;
          padding: 10px;
          font-family: 'SF Mono', monospace;
          font-size: 22px;
          font-weight: 700;
          text-align: center;
          border: 2px solid #cbd5e1;
          border-radius: 8px;
          color: #0f172a;
        }
        .qs-inputs input:focus {
          border-color: var(--brand-primary, #002d72);
          outline: none;
        }
        .qs-dash {
          font-size: 22px;
          color: #94a3b8;
          padding-top: 14px;
        }
        .qs-submit {
          padding: 12px 24px;
          font-size: 14px;
          font-weight: 700;
          background: var(--brand-primary, #002d72);
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: filter 0.15s;
        }
        .qs-submit:hover:not(:disabled) {
          filter: brightness(1.1);
        }
        .qs-submit:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        @media (max-width: 600px) {
          .qs-row {
            grid-template-columns: 1fr;
            gap: 10px;
          }
          .qs-submit {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}

function formatDate(yyyymmdd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) return yyyymmdd;
  const d = new Date(`${yyyymmdd}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

"use client";

// Live scorer page — separate URL for the at-the-field scorekeeper.
// Designed for one-thumb operation on a phone in the dugout.
//
// Layout: two giant team panels stacked or side-by-side, each with
// a current score and a "+1 run" tap target. Inning indicator in
// the middle. Bottom bar: undo, advance half-inning, set custom
// score, finalize.
//
// Auth: admin or captain of either team. Hits /api/live-score.
// Public can watch the same scoreboard at /games/[id] which polls
// every few seconds when the game is in "live" status.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTenant } from "@/lib/tenant-context";
import { useUser, useLeagueRole, useCaptainTeam } from "@/lib/auth-client";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import "./score.css";

interface LiveGame {
  id: string;
  status: string;
  away_team_id: string;
  home_team_id: string;
  away_team_name: string;
  home_team_name: string;
  away_score: number;
  home_score: number;
  current_inning: number;
  current_half: "top" | "bottom";
  field: string;
}

export default function LiveScorerPage() {
  const params = useParams<{ gameId: string }>();
  const gameId = params.gameId;
  const { tenantId, config } = useTenant();
  const user = useUser();
  const role = useLeagueRole(tenantId);
  const { teamId: captainTeamId } = useCaptainTeam(tenantId);

  const [game, setGame] = useState<LiveGame | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);

  // Subscribe to game doc — every score update from anyone (admin
  // override, opposing scorekeeper, etc.) reflects live in this
  // session.
  useEffect(() => {
    if (!tenantId || !gameId) return;
    const db = getDb();
    const ref = doc(db, `leagues/${tenantId}/games/${gameId}`);
    const unsub = onSnapshot(
      ref,
      async (snap) => {
        if (!snap.exists()) {
          setError("Game not found");
          setLoading(false);
          return;
        }
        const data = snap.data();
        // Resolve team names — only on first load to avoid extra reads.
        let awayName = data.away_team_name as string | undefined;
        let homeName = data.home_team_name as string | undefined;
        if (!awayName || !homeName) {
          const [a, h] = await Promise.all([
            getDoc(
              doc(db, `leagues/${tenantId}/teams/${data.away_team_id}`),
            ),
            getDoc(
              doc(db, `leagues/${tenantId}/teams/${data.home_team_id}`),
            ),
          ]);
          awayName = (a.data()?.name as string | undefined) ?? data.away_team_id;
          homeName = (h.data()?.name as string | undefined) ?? data.home_team_id;
        }
        setGame({
          id: gameId,
          status: String(data.status ?? "scheduled"),
          away_team_id: String(data.away_team_id ?? ""),
          home_team_id: String(data.home_team_id ?? ""),
          away_team_name: String(awayName),
          home_team_name: String(homeName),
          away_score: Number(data.away_score) || 0,
          home_score: Number(data.home_score) || 0,
          current_inning: Number(data.current_inning) || 1,
          current_half:
            data.current_half === "bottom" ? "bottom" : "top",
          field: String(data.field ?? ""),
        });
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [tenantId, gameId]);

  // Compute auth: admin OR captain of either team.
  useEffect(() => {
    if (!game) return;
    if (role === "admin") {
      setAuthorized(true);
      return;
    }
    if (
      captainTeamId &&
      (captainTeamId === game.away_team_id ||
        captainTeamId === game.home_team_id)
    ) {
      setAuthorized(true);
      return;
    }
    setAuthorized(false);
  }, [role, captainTeamId, game]);

  async function call(body: Record<string, unknown>) {
    if (!user || !tenantId || !gameId) return;
    setBusy(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/live-score", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId: tenantId, gameId, ...body }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <main className="ls-shell">
        <p>Loading…</p>
      </main>
    );
  if (error)
    return (
      <main className="ls-shell">
        <p className="ls-error">⚠ {error}</p>
      </main>
    );
  if (!game) return null;

  if (user === null) {
    return (
      <main className="ls-shell">
        <h1>Sign in to score this game</h1>
        <p>Only admins and captains of either team can update the score.</p>
        <Link
          href={`/login?next=/score/${gameId}`}
          className="ls-btn ls-btn-primary"
        >
          Sign in
        </Link>
      </main>
    );
  }

  if (!authorized) {
    return (
      <main className="ls-shell">
        <h1>Not authorized</h1>
        <p>
          Only admins and captains of {game.away_team_name} or{" "}
          {game.home_team_name} can update this game's score.
        </p>
        <Link href={`/games/${gameId}`} className="ls-btn ls-btn-secondary">
          View game page instead
        </Link>
      </main>
    );
  }

  const isLive = game.status === "live";
  const isFinal = game.status === "final" || game.status === "approved";
  const halfLabel = game.current_half === "top" ? "TOP" : "BOT";

  return (
    <main className={`ls-shell ${isLive ? "ls-live" : ""}`}>
      <header className="ls-header">
        <Link
          href={`/games/${gameId}`}
          style={{
            color: "rgba(255,255,255,0.7)",
            fontSize: 12,
            textDecoration: "none",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          ← Game page
        </Link>
        <span className="ls-status">
          {isLive ? (
            <>
              <span className="ls-live-dot" /> LIVE
            </>
          ) : isFinal ? (
            "FINAL"
          ) : (
            game.status.toUpperCase()
          )}
        </span>
        {game.field && <span className="ls-field">{game.field}</span>}
      </header>

      {/* ── Inning bar ─── */}
      <div className="ls-inning">
        <button
          type="button"
          className="ls-inning-btn"
          onClick={() => {
            // Quick "back" — go to previous half.
            const half = game.current_half === "top" ? "bottom" : "top";
            const inning =
              game.current_half === "top"
                ? Math.max(1, game.current_inning - 1)
                : game.current_inning;
            call({ action: "set_inning", inning, half });
          }}
          disabled={busy}
        >
          ◀
        </button>
        <div className="ls-inning-display">
          <span className="ls-inning-half">{halfLabel}</span>
          <span className="ls-inning-num">{game.current_inning}</span>
        </div>
        <button
          type="button"
          className="ls-inning-btn"
          onClick={() => call({ action: "advance_inning" })}
          disabled={busy}
        >
          ▶
        </button>
      </div>

      {/* ── Score panels ─── */}
      <section className="ls-scoreboard">
        <ScorePanel
          label="Away"
          team={game.away_team_name}
          score={game.away_score}
          isUp={game.current_half === "top"}
          onPlus={() => call({ action: "run", side: "away", delta: 1 })}
          onMinus={() => call({ action: "run", side: "away", delta: -1 })}
          busy={busy}
        />
        <ScorePanel
          label="Home"
          team={game.home_team_name}
          score={game.home_score}
          isUp={game.current_half === "bottom"}
          onPlus={() => call({ action: "run", side: "home", delta: 1 })}
          onMinus={() => call({ action: "run", side: "home", delta: -1 })}
          busy={busy}
        />
      </section>

      {/* ── Footer actions ─── */}
      <footer className="ls-footer">
        {!isLive && !isFinal && (
          <button
            type="button"
            className="ls-btn ls-btn-primary"
            onClick={() => call({ action: "go_live" })}
            disabled={busy}
          >
            🟢 Go LIVE
          </button>
        )}
        {isLive && (
          <button
            type="button"
            className="ls-btn ls-btn-danger"
            onClick={() => {
              if (
                window.confirm(
                  `Finalize the game at ${game.away_score}-${game.home_score}? Game flips to status FINAL and standings update.`,
                )
              ) {
                call({ action: "finalize" });
              }
            }}
            disabled={busy}
          >
            ✓ FINAL
          </button>
        )}
        {isFinal && (
          <button
            type="button"
            className="ls-btn ls-btn-secondary"
            onClick={() => call({ action: "undo_final" })}
            disabled={busy}
          >
            ↶ Undo final
          </button>
        )}
      </footer>

      <p className="ls-hint">
        Public scoreboard at{" "}
        <Link href={`/games/${gameId}`}>{`/games/${gameId}`}</Link>{" "}
        — shows live score with a 5s refresh during the game.
      </p>
    </main>
  );
}

function ScorePanel({
  label,
  team,
  score,
  isUp,
  onPlus,
  onMinus,
  busy,
}: {
  label: string;
  team: string;
  score: number;
  isUp: boolean;
  onPlus: () => void;
  onMinus: () => void;
  busy: boolean;
}) {
  return (
    <div className={`ls-panel ${isUp ? "ls-panel-up" : ""}`}>
      <div className="ls-panel-head">
        <span className="ls-panel-label">{label}</span>
        {isUp && <span className="ls-panel-batting">at bat</span>}
      </div>
      <div className="ls-panel-team">{team}</div>
      <button
        type="button"
        className="ls-score-btn"
        onClick={onPlus}
        disabled={busy}
        aria-label={`+1 run for ${team}`}
      >
        <span className="ls-score-number">{score}</span>
        <span className="ls-score-cta">TAP TO ADD RUN</span>
      </button>
      <button
        type="button"
        className="ls-undo-btn"
        onClick={onMinus}
        disabled={busy || score === 0}
        aria-label={`Undo last run for ${team}`}
      >
        − undo
      </button>
    </div>
  );
}

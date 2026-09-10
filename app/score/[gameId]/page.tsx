"use client";

// Live scorer page — separate URL for the at-the-field scorekeeper.
// Designed for one-thumb operation on a phone in the dugout, or at the
// scorer's table.
//
// Layout: two giant team panels stacked or side-by-side, each with a
// current score and a "+1 run" tap target. Inning indicator in the middle.
// Bottom bar: undo, advance half-inning, set custom score, finalize.
//
// BASKETBALL (config.sport === "basketball"): the same page, with the
// inning bar reading Q1–Q4 / OT and each panel offering +1 / +2 / +3
// (free throw, field goal, three) instead of one tap. The game doc's
// current_inning is reused as the period; current_half is ignored.
//
// Auth: admin (full, or the "scores" scope — a town commissioner, for their
// own town's games) or captain of either team. Hits /api/live-score, which
// is where the town boundary is actually enforced. Public can watch the
// same scoreboard at /games/[id], which polls every few seconds when the
// game is in "live" status.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTenant } from "@/lib/tenant-context";
import { useUser, useAdminAccess, useCaptainTeam } from "@/lib/auth-client";
import { periodLabel } from "@/lib/sport-labels";
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
  const access = useAdminAccess(tenantId);
  const { teamId: captainTeamId } = useCaptainTeam(tenantId);
  const isBasketball = config?.sport === "basketball";

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

  // Compute auth: admin (full or "scores" scope) OR captain of either team.
  // A commissioner's town is checked by the API, not here: the page has no
  // cheap way to know which town a team belongs to, and the server refuses
  // with a message this page shows.
  useEffect(() => {
    if (!game) return;
    if (access !== "loading" && (access.full || access.scopes.has("scores"))) {
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
  }, [access, captainTeamId, game]);

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
  if (error && !game)
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
        <p>
          Only league admins{isBasketball ? ", commissioners" : ""} and captains
          of either team can update the score.
        </p>
        <Link
          href={isBasketball ? "/admin" : `/login?next=/score/${gameId}`}
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
          {game.home_team_name} can update this game&apos;s score.
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
  const period = game.current_inning;
  // Basketball: 1–4 are quarters, 5+ are overtimes; no halves.
  const stepBack = () =>
    isBasketball
      ? call({ action: "set_inning", inning: Math.max(1, period - 1), half: "top" })
      : call({
          action: "set_inning",
          inning: game.current_half === "top" ? Math.max(1, period - 1) : period,
          half: game.current_half === "top" ? "bottom" : "top",
        });
  const stepForward = () =>
    isBasketball
      ? call({ action: "set_inning", inning: Math.min(30, period + 1), half: "top" })
      : call({ action: "advance_inning" });
  const steps: number[] = isBasketball ? [1, 2, 3] : [1];

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

      {error && <p className="ls-error">⚠ {error}</p>}

      {/* ── Inning / period bar ─── */}
      <div className="ls-inning">
        <button
          type="button"
          className="ls-inning-btn"
          onClick={stepBack}
          disabled={busy}
          aria-label={isBasketball ? "Previous period" : "Previous half-inning"}
        >
          ◀
        </button>
        <div className="ls-inning-display">
          {isBasketball ? (
            <>
              <span className="ls-inning-half">{period <= 4 ? "PERIOD" : "OVERTIME"}</span>
              <span className="ls-inning-num">{periodLabel("basketball", period)}</span>
            </>
          ) : (
            <>
              <span className="ls-inning-half">{halfLabel}</span>
              <span className="ls-inning-num">{period}</span>
            </>
          )}
        </div>
        <button
          type="button"
          className="ls-inning-btn"
          onClick={stepForward}
          disabled={busy}
          aria-label={isBasketball ? "Next period" : "Next half-inning"}
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
          isUp={!isBasketball && game.current_half === "top"}
          steps={steps}
          unit={isBasketball ? "point" : "run"}
          onAdd={(delta) => call({ action: "run", side: "away", delta })}
          onMinus={() => call({ action: "run", side: "away", delta: -1 })}
          busy={busy}
        />
        <ScorePanel
          label="Home"
          team={game.home_team_name}
          score={game.home_score}
          isUp={!isBasketball && game.current_half === "bottom"}
          steps={steps}
          unit={isBasketball ? "point" : "run"}
          onAdd={(delta) => call({ action: "run", side: "home", delta })}
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
  steps,
  unit,
  onAdd,
  onMinus,
  busy,
}: {
  label: string;
  team: string;
  score: number;
  isUp: boolean;
  /** Point values offered: [1] for a bat-and-ball sport, [1, 2, 3] for
   *  basketball. With one step the whole score tile is the tap target. */
  steps: number[];
  unit: "run" | "point";
  onAdd: (delta: number) => void;
  onMinus: () => void;
  busy: boolean;
}) {
  const single = steps.length === 1;
  return (
    <div className={`ls-panel ${isUp ? "ls-panel-up" : ""}`}>
      <div className="ls-panel-head">
        <span className="ls-panel-label">{label}</span>
        {isUp && <span className="ls-panel-batting">at bat</span>}
      </div>
      <div className="ls-panel-team">{team}</div>
      {single ? (
        <button
          type="button"
          className="ls-score-btn"
          onClick={() => onAdd(1)}
          disabled={busy}
          aria-label={`+1 ${unit} for ${team}`}
        >
          <span className="ls-score-number">{score}</span>
          <span className="ls-score-cta">TAP TO ADD {unit.toUpperCase()}</span>
        </button>
      ) : (
        <>
          <div className="ls-score-btn ls-score-static" aria-live="polite">
            <span className="ls-score-number">{score}</span>
          </div>
          <div className="ls-steps">
            {steps.map((n) => (
              <button
                key={n}
                type="button"
                className="ls-step-btn"
                onClick={() => onAdd(n)}
                disabled={busy}
                aria-label={`+${n} ${n === 1 ? unit : `${unit}s`} for ${team}`}
              >
                +{n}
              </button>
            ))}
          </div>
        </>
      )}
      <button
        type="button"
        className="ls-undo-btn"
        onClick={onMinus}
        disabled={busy || score === 0}
        aria-label={`Take back one ${unit} for ${team}`}
      >
        − undo
      </button>
    </div>
  );
}

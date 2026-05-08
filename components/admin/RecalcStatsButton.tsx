"use client";

// Recalculates per-player batting + pitching aggregates by reading
// every final/approved box score under /leagues/{id}/box_scores and
// writing the rolled-up totals back to /players/{pid}.stats.
//
// Surfaced in two places: the Health dashboard (where stale stats
// would be most visible) and the Tools tab (with the smoke test).
// Same component, same handler — no duplicate logic.

import { useState } from "react";
import type { User } from "firebase/auth";

interface Props {
  tenantId: string;
  user: User;
  /** Optional rendering hint — `compact` for the Health dashboard
   *  (small inline button), `full` for the Tools tab (full panel). */
  variant?: "compact" | "full";
}

interface RecalcResult {
  box_scores_read: number;
  players_aggregated: number;
  players_written: number;
  pitchers_written: number;
  duration_ms: number;
}

export function RecalcStatsButton({ tenantId, user, variant = "full" }: Props) {
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "ok"; result: RecalcResult }
    | { kind: "err"; message: string }
  >({ kind: "idle" });

  async function run() {
    setStatus({ kind: "running" });
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/recalc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ leagueId: tenantId }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as RecalcResult;
      setStatus({ kind: "ok", result });
    } catch (err) {
      setStatus({
        kind: "err",
        message: err instanceof Error ? err.message : "Unknown error.",
      });
    }
  }

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={run}
          disabled={status.kind === "running"}
          className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white disabled:opacity-50 hover:brightness-110"
          title="Recompute every player's batting/pitching totals from final box scores"
        >
          {status.kind === "running" ? "Recalculating…" : "↻ Recalc stats"}
        </button>
        {status.kind === "ok" && (
          <span className="text-xs text-emerald-700">
            ✓ {status.result.players_written} players ·{" "}
            {status.result.box_scores_read} games ·{" "}
            {status.result.duration_ms}ms
          </span>
        )}
        {status.kind === "err" && (
          <span className="text-xs text-red-700">❌ {status.message}</span>
        )}
      </div>
    );
  }

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <p className="font-semibold text-slate-900">Recalc league stats</p>
      <p className="text-sm text-slate-600">
        Reads every final/approved box score, aggregates per-player batting
        (and pitching for baseball), writes results to each player's stats.
        Skips players whose totals haven't changed (dirty-check).
      </p>
      <button
        onClick={run}
        disabled={status.kind === "running"}
        className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {status.kind === "running" ? "Recalculating…" : "Recalc league stats"}
      </button>
      {status.kind === "ok" && (
        <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
          {JSON.stringify(status.result, null, 2)}
        </pre>
      )}
      {status.kind === "err" && (
        <p className="text-sm text-red-700">❌ {status.message}</p>
      )}
    </section>
  );
}

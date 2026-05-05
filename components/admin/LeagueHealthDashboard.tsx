"use client";

// Top-of-admin at-a-glance card. Counts that answer the questions
// commissioners ask out loud most often:
//   - "How many teams again?"
//   - "Did everyone get their captain access?"
//   - "How many games left this week?"
//   - "Are people actually using the push notifications?"
//
// Refresh button + auto-reload on mount. Stays compact.

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

interface Health {
  teams: { active: number; total: number };
  players: {
    active: number;
    total: number;
    with_email: number;
    linked_to_auth: number;
  };
  games: {
    total: number;
    scheduled: number;
    final: number;
    postponed: number;
    cancelled: number;
    draft: number;
  };
  games_final_last_24h: number;
  subscribers: {
    devices: number;
    captain_authed: number;
    admin: number;
  };
  recent_activity: {
    window_hours: number;
    by_kind: Record<string, number>;
    total: number;
  };
}

interface Props {
  leagueId: string;
  user: User;
}

export function LeagueHealthDashboard({ leagueId, user }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(
        `/api/admin-league-health?leagueId=${encodeURIComponent(leagueId)}`,
        { headers: { authorization: `Bearer ${idToken}` } },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as Health;
      setHealth(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [user, leagueId]);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">League health</p>
          <p className="text-xs text-slate-600 mt-1">
            At-a-glance snapshot of the league.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchHealth}
          disabled={loading}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 rounded bg-red-50 px-2 py-1 border border-red-200">
          {error}
        </p>
      )}

      {!health ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Teams"
              value={health.teams.active}
              sub={
                health.teams.total > health.teams.active
                  ? `${health.teams.total - health.teams.active} inactive`
                  : "active"
              }
            />
            <Stat
              label="Players"
              value={health.players.active}
              sub={`${health.players.linked_to_auth} signed in`}
            />
            <Stat
              label="Games"
              value={health.games.total}
              sub={`${health.games.final} final · ${health.games.scheduled} upcoming`}
              tone={
                health.games.final === 0 && health.games.scheduled === 0
                  ? "warn"
                  : "ok"
              }
            />
            <Stat
              label="Push subscribers"
              value={health.subscribers.devices}
              sub={`${health.subscribers.captain_authed} captain-authed`}
              tone={health.subscribers.devices === 0 ? "warn" : "ok"}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-2">
            <SmallStat
              label="Players with email on file"
              value={`${health.players.with_email} / ${health.players.active}`}
              hint={
                health.players.with_email === 0
                  ? "No emails — captains/players can't sign in via magic link until added."
                  : null
              }
            />
            <SmallStat
              label="Games final last 24h"
              value={String(health.games_final_last_24h)}
              hint={null}
            />
            <SmallStat
              label="Recent activity (24h)"
              value={String(health.recent_activity.total)}
              hint={
                Object.keys(health.recent_activity.by_kind).length === 0
                  ? "Quiet"
                  : Object.entries(health.recent_activity.by_kind)
                      .map(([k, v]) => `${v} ${humanizeKind(k)}`)
                      .join(", ")
              }
            />
          </div>

          {/* Yellow-flag warnings — show only when something looks off
              so the dashboard stays clean once everything's healthy. */}
          {(() => {
            const flags: string[] = [];
            if (health.teams.active === 0) {
              flags.push(
                "No active teams. Provision the league or check the Teams section below.",
              );
            }
            if (
              health.teams.active > 0 &&
              health.players.active === 0
            ) {
              flags.push(
                "Teams exist but no players. Run roster CSV import or have captains add players.",
              );
            }
            if (
              health.players.active > 0 &&
              health.players.with_email === 0
            ) {
              flags.push(
                "No players have emails. Captains can't sign in via magic link until you add them.",
              );
            }
            if (
              health.players.linked_to_auth === 0 &&
              health.players.with_email > 0
            ) {
              flags.push(
                "No players have signed in yet. Send the captain welcome email (see docs/onboarding-emails.md).",
              );
            }
            if (
              health.games.scheduled === 0 &&
              health.games.final === 0
            ) {
              flags.push(
                "No games on the schedule. Run the schedule CSV import.",
              );
            }
            if (flags.length === 0) return null;
            return (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2">
                <p className="text-xs font-semibold text-amber-900 mb-1">
                  Heads up
                </p>
                <ul className="text-xs text-amber-800 space-y-0.5 list-disc pl-4">
                  {flags.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            );
          })()}
        </>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "ok",
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div
      className={
        "rounded-md border p-3 " +
        (tone === "warn"
          ? "border-amber-200 bg-amber-50"
          : "border-slate-200 bg-slate-50")
      }
    >
      <div className="text-[10px] uppercase tracking-wider text-slate-600 font-semibold">
        {label}
      </div>
      <div className="text-2xl font-bold text-slate-900 leading-tight">
        {value}
      </div>
      {sub && (
        <div className="text-xs text-slate-600 mt-0.5">{sub}</div>
      )}
    </div>
  );
}

function SmallStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string | null;
}) {
  return (
    <div className="rounded border border-slate-200 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
        {label}
      </div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
      {hint && (
        <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>
      )}
    </div>
  );
}

function humanizeKind(k: string): string {
  if (k === "schedule_edit") return "schedule edit";
  return k.replace(/_/g, " ");
}

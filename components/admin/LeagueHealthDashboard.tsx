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
  /** Sample season still present, if any. Absent on older responses. */
  demo?: { teams: number; games: number };
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
  pending_forms?: {
    total: number;
    player_registration?: number;
    team_registration?: number;
    team_waiver?: number;
    umpire_evaluation?: number;
    site_feedback?: number;
    player_waiver?: number;
  };
  site_visits?: {
    total: number;
    today: number;
    last7: number;
  };
}

interface Props {
  leagueId: string;
  user: User;
  /** Jump to the Form submissions tab — wired from the admin page so
   *  the "new submissions" callout is actionable. */
  onReviewForms?: () => void;
}

export function LeagueHealthDashboard({ leagueId, user, onReviewForms }: Props) {
  // NOT gated on stats_enabled. That was a wrong reading: stats off means no
  // batting averages, NOT no rosters. Island has stats off and 36 players
  // across three teams, so gating on it hid warnings the office could act on.
  // The original problem was the WORDING, which pointed at a CSV importer
  // that does not exist and at a file in the repository. That is fixed below.
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState<string | null>(null);

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
          {/* Sample season. Shown only while there IS one, so it disappears
              the moment it is used and never becomes furniture.

              This exists because removing the seeded season previously needed
              a script and a terminal, which meant it needed Adam, which meant
              it did not happen. Mike, 2026-09-01: "Schedule in admin, not
              deleting sample games." Deleting them one at a time worked but
              left the eight sample TEAMS on the standings, so the job never
              looked done. */}
          {(health.demo?.teams ?? 0) + (health.demo?.games ?? 0) > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-bold text-amber-900">
                Sample data is still on the site
              </p>
              <p className="mt-0.5 text-xs text-amber-800">
                {health.demo?.teams ?? 0} sample team
                {(health.demo?.teams ?? 0) === 1 ? "" : "s"} and{" "}
                {health.demo?.games ?? 0} sample game
                {(health.demo?.games ?? 0) === 1 ? "" : "s"}, including results
                with scores. Real visitors see these on the schedule, the
                standings and the home page.
              </p>
              {removed ? (
                <p className="mt-2 text-xs font-bold text-emerald-800">{removed}</p>
              ) : (
                <button
                  type="button"
                  disabled={removing}
                  onClick={async () => {
                    const t = health.demo?.teams ?? 0;
                    const g = health.demo?.games ?? 0;
                    if (
                      !window.confirm(
                        `Delete ${t} sample team${t === 1 ? "" : "s"} and ${g} sample game${g === 1 ? "" : "s"}?\n\nThis cannot be undone. Only sample data is removed; real teams and real games are not touched.`,
                      )
                    )
                      return;
                    setRemoving(true);
                    setError(null);
                    try {
                      const idToken = await user.getIdToken();
                      const res = await fetch("/api/admin-remove-demo", {
                        method: "POST",
                        headers: {
                          "content-type": "application/json",
                          authorization: `Bearer ${idToken}`,
                        },
                        body: JSON.stringify({ leagueId }),
                      });
                      const data = (await res.json().catch(() => ({}))) as {
                        error?: string;
                        teams?: number;
                        games?: number;
                      };
                      if (!res.ok) {
                        setError(data.error ?? `Failed (${res.status})`);
                      } else {
                        setRemoved(
                          `Removed ${data.teams ?? 0} sample teams and ${data.games ?? 0} sample games.`,
                        );
                        fetchHealth();
                      }
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Failed");
                    } finally {
                      setRemoving(false);
                    }
                  }}
                  className="mt-2 rounded-md bg-amber-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                >
                  {removing ? "Removing…" : "Remove all sample data"}
                </button>
              )}
            </div>
          )}
          {health.pending_forms && health.pending_forms.total > 0 && (
            <button
              type="button"
              onClick={onReviewForms}
              disabled={!onReviewForms}
              className="block w-full rounded-md border border-blue-300 bg-blue-50 p-3 text-left hover:bg-blue-100 disabled:cursor-default disabled:hover:bg-blue-50"
            >
              <p className="text-sm font-bold text-blue-900">
                📋 {health.pending_forms.total} new form submission
                {health.pending_forms.total === 1 ? "" : "s"} to review
                {onReviewForms && " →"}
              </p>
              <p className="mt-0.5 text-xs text-blue-800">
                {(
                  [
                    [health.pending_forms.player_registration, "player registration"],
                    [health.pending_forms.team_registration, "team registration"],
                    [health.pending_forms.team_waiver, "team waiver"],
                    [health.pending_forms.umpire_evaluation, "umpire eval"],
                    [health.pending_forms.site_feedback, "site feedback"],
                    [health.pending_forms.player_waiver, "signed waivers"],
                  ] as [number | undefined, string][]
                )
                  .filter(([n]) => (n ?? 0) > 0)
                  .map(([n, label]) => `${n} ${label}${n === 1 ? "" : "s"}`)
                  .join(" · ")}
                {" — open the Form submissions tab to handle them."}
              </p>
            </button>
          )}
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
            <Stat
              label="Site visits"
              value={(health.site_visits?.total ?? 0).toLocaleString()}
              sub={`${(health.site_visits?.today ?? 0).toLocaleString()} today · ${(
                health.site_visits?.last7 ?? 0
              ).toLocaleString()} last 7 days`}
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
            // ROSTER ADVICE, only for leagues that keep rosters.
            //
            // Island is score-only (flags.stats_enabled === false): coaches
            // report a final score and no player is ever entered. It sat on a
            // permanent amber warning telling the office to "run roster CSV
            // import", which is both irrelevant and impossible — there is no
            // CSV import tab in this admin. A warning that can never be
            // cleared teaches people to ignore the warning box.
            if (
              health.teams.active > 0 &&
              health.players.active === 0
            ) {
              flags.push(
                "Teams exist but no players. Have captains add players to their rosters.",
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
              // Was "see docs/onboarding-emails.md", a file in the repository.
              // The person reading this runs a softball league.
              flags.push(
                "No players have signed in yet. Send the coaches their sign-in codes from the Captains tab.",
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

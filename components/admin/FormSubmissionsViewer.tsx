"use client";

// Admin form-submission inbox. Tabs across the four public forms
// (player registration, team registration, team waiver, umpire
// evaluation), reverse-chronological table per kind, click a row to
// expand and see every field.
//
// No mutate / delete — review and act outside the system (email,
// payment confirmation, roster grant). Submissions sit in Firestore
// indefinitely as a paper trail.
//
// Reads via /api/admin-form-submissions which gates on the admin
// claim. Same auth pattern as the audit-log + signups viewers.

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

type Kind =
  | "player_registration"
  | "team_registration"
  | "team_waiver"
  | "umpire_evaluation";

const KIND_TABS: { key: Kind; label: string }[] = [
  { key: "player_registration", label: "Player registration" },
  { key: "team_registration", label: "Team registration" },
  { key: "team_waiver", label: "Team waiver" },
  { key: "umpire_evaluation", label: "Umpire evaluation" },
];

interface Submission {
  id: string;
  submitted_at: string;
  [k: string]: unknown;
}

interface Props {
  leagueId: string;
  user: User;
}

export function FormSubmissionsViewer({ leagueId, user }: Props) {
  const [kind, setKind] = useState<Kind>("player_registration");
  const [items, setItems] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const params = new URLSearchParams({ leagueId, kind, limit: "100" });
      const res = await fetch(
        `/api/admin-form-submissions?${params.toString()}`,
        { headers: { authorization: `Bearer ${idToken}` } },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        setItems([]);
        return;
      }
      const data = (await res.json()) as { items?: Submission[] };
      setItems(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [user, leagueId, kind]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="font-semibold text-slate-900">Form submissions</p>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            Public-facing forms write here. Review entries to confirm
            payment, grant roster access, or assign a team.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchItems}
          disabled={loading}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {KIND_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setKind(t.key);
              setExpanded(null);
            }}
            className={
              "px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap " +
              (kind === t.key
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-700 rounded bg-red-50 px-2 py-1 border border-red-200">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          No {KIND_TABS.find((t) => t.key === kind)?.label.toLowerCase()}{" "}
          submissions yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 border border-slate-200 rounded-md overflow-hidden">
          {items.map((it) => (
            <li key={it.id} className="text-xs">
              <button
                type="button"
                onClick={() =>
                  setExpanded((cur) => (cur === it.id ? null : it.id))
                }
                className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-2"
              >
                <span className="flex-1 min-w-0 truncate">
                  <span className="font-semibold text-slate-900">
                    {summaryLine(kind, it)}
                  </span>
                </span>
                <span className="text-[11px] text-slate-500 font-mono whitespace-nowrap">
                  {fmtTime(String(it.submitted_at ?? ""))}
                </span>
              </button>
              {expanded === it.id && (
                <pre className="px-3 py-2 bg-slate-50 text-[11px] text-slate-800 font-mono overflow-x-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(omitNoise(it), null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// One-line preview per submission kind. Surfaces the most useful
// identifying field(s) so the admin can scan a list of 50 at a glance.
function summaryLine(kind: Kind, s: Submission): string {
  if (kind === "player_registration") {
    const fn = s.first_name ?? "";
    const ln = s.last_name ?? "";
    const div = s.division ?? "";
    const team = s.team_name ?? "";
    return [
      `${fn} ${ln}`.trim() || "(unnamed)",
      div && `· ${div}`,
      team && `· ${team}`,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (kind === "team_registration") {
    const team = s.team_name ?? "(unnamed team)";
    const mgr = `${s.manager_first_name ?? ""} ${s.manager_last_name ?? ""}`.trim();
    return mgr ? `${team} — ${mgr}` : String(team);
  }
  if (kind === "team_waiver") {
    return String(s.team_name ?? "(unnamed team)") +
      (s.signature ? ` — signed by ${s.signature}` : "");
  }
  if (kind === "umpire_evaluation") {
    const ev = s.evaluator_name ?? "";
    const date = s.game_date ?? "";
    const matchup = `${s.visiting_team ?? "?"} @ ${s.home_team ?? "?"}`;
    return `${matchup}${date ? ` (${date})` : ""}${ev ? ` — ${ev}` : ""}`;
  }
  return s.id;
}

function omitNoise(s: Submission): Record<string, unknown> {
  // Hide the auto-injected fields the admin doesn't need to read.
  const { id: _id, ...rest } = s;
  return rest;
}

function fmtTime(iso: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

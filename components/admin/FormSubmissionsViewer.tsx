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
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { feeFor } from "@/lib/fees";

type Kind =
  | "player_registration"
  | "team_registration"
  | "team_waiver"
  | "umpire_evaluation"
  | "site_feedback"
  | "player_waiver";

const KIND_TABS: { key: Kind; label: string }[] = [
  { key: "player_registration", label: "Player registration" },
  { key: "team_registration", label: "Team registration" },
  { key: "team_waiver", label: "Team waiver" },
  { key: "umpire_evaluation", label: "Umpire evaluation" },
  { key: "player_waiver", label: "Signed waivers" },
  { key: "site_feedback", label: "Site feedback" },
];

// Three states a submission can occupy. Missing status field on
// existing docs is treated as "new" — pre-workflow submissions
// migrate implicitly when an admin first interacts with them.
type Status = "new" | "in_progress" | "done";

// Status icon + text travel together on every status pill so the row
// glance reads at sub-second speed: shape and color tell you the
// state even before the word registers. Matches the original pitch
// Adam approved.
const STATUS_ICON: Record<Status, string> = {
  new: "⭕",
  in_progress: "👀",
  done: "✅",
};

const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  in_progress: "In progress",
  done: "Done",
};

const STATUS_PILL: Record<Status, string> = {
  new: "bg-blue-100 text-blue-800 border-blue-200",
  in_progress: "bg-amber-100 text-amber-800 border-amber-200",
  done: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

// Single-click advance: new → in_progress → done → in_progress (so a
// done can be reopened without an extra step).
const NEXT_STATUS: Record<Status, Status> = {
  new: "in_progress",
  in_progress: "done",
  done: "in_progress",
};

const NEXT_LABEL: Record<Status, string> = {
  new: "Start review",
  in_progress: "Mark done",
  done: "Reopen",
};

// "deleted" is a virtual filter — soft-deleted docs are excluded
// from every other view (Actionable / New / In progress / Done /
// All all hide deleted), and the Deleted pill is the only place to
// see them. Restoring from Deleted brings the row back wherever it
// would have lived.
type FilterMode = "actionable" | "all" | "deleted" | Status;

interface Submission {
  id: string;
  submitted_at: string;
  status?: Status;
  deleted?: boolean;
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
  const [filter, setFilter] = useState<FilterMode>("actionable");
  const [busy, setBusy] = useState<string | null>(null);
  // Actionable count per FORM, shown as a badge on each tab. Without
  // it the viewer opens on Player registration, and a league whose
  // only waiting entry is a Team registration reads as an empty
  // inbox — the tab strip gives no hint that another form has mail.
  const [tabCounts, setTabCounts] = useState<Partial<Record<Kind, number>>>({});
  // Teams for the "Assign to team" picker on player_registration
  // rows. Public collection — a plain client read is fine.
  const [teams, setTeams] = useState<
    { id: string; name: string; division: string; ageGroup: string }[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          collection(getDb(), `leagues/${leagueId}/teams`),
        );
        if (cancelled) return;
        setTeams(
          snap.docs
            .map((d) => ({
              id: d.id,
              name: String(d.data().name ?? d.id),
              division: String(d.data().division ?? ""),
              ageGroup: String(d.data().ageGroup ?? ""),
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch {
        /* picker just stays empty if teams can't load */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  function statusOf(s: Submission): Status {
    return s.status ?? "new";
  }

  // Optimistically merge fields into a row after an assign.
  function patchItem(id: string, patch: Partial<Submission>) {
    setItems((cur) =>
      cur.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }

  async function advanceStatus(s: Submission) {
    const next = NEXT_STATUS[statusOf(s)];
    setBusy(s.id);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-form-submission-status", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, kind, id: s.id, status: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // Optimistic: patch in place so the row updates without a full
      // re-fetch. Caller can hit Refresh if they want to re-sync.
      setItems((cur) =>
        cur.map((row) => (row.id === s.id ? { ...row, status: next } : row)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function setDeleted(s: Submission, deleted: boolean) {
    if (deleted) {
      // Confirm before trashing — the audit log records who/what but
      // a confirm prompt is the cheap UX guard against misclicks.
      const summary = summaryLine(kind, s);
      const ok = window.confirm(
        `Delete this submission?\n\n${summary}\n\n` +
          `It'll move to the Deleted tab and can be restored from there.`,
      );
      if (!ok) return;
    }
    setBusy(s.id);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-form-submission-delete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, kind, id: s.id, deleted }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setItems((cur) =>
        cur.map((row) =>
          row.id === s.id ? { ...row, deleted } : row,
        ),
      );
      // Collapse if the just-deleted row was expanded — it's about
      // to disappear from the active view anyway.
      setExpanded((cur) => (cur === s.id ? null : cur));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      // 500 is the server's clamp (app/api/admin-form-submissions). At 100 a
      // league the size of COYBL (196 teams) silently lost roughly half its
      // registrations from the director's inbox, with no pagination and no
      // indication anything was missing.
      const params = new URLSearchParams({ leagueId, kind, limit: "500" });
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

  // Tab badges. Four small reads, fired together, and deliberately
  // silent on failure: a badge that can't load must not blank out the
  // inbox the admin actually came for.
  const fetchTabCounts = useCallback(async () => {
    try {
      const idToken = await user.getIdToken();
      const entries = await Promise.all(
        KIND_TABS.map(async (t) => {
          const params = new URLSearchParams({
            leagueId,
            kind: t.key,
            limit: "500",
          });
          const res = await fetch(
            `/api/admin-form-submissions?${params.toString()}`,
            { headers: { authorization: `Bearer ${idToken}` } },
          );
          if (!res.ok) return [t.key, 0] as const;
          const data = (await res.json()) as { items?: Submission[] };
          const n = (data.items ?? []).filter(
            (s) => !s.deleted && (s.status ?? "new") !== "done",
          ).length;
          return [t.key, n] as const;
        }),
      );
      setTabCounts(Object.fromEntries(entries) as Record<Kind, number>);
    } catch {
      // leave the previous badges in place
    }
  }, [user, leagueId]);

  useEffect(() => {
    fetchTabCounts();
  }, [fetchTabCounts]);

  // Keep the active tab's badge honest after a status change or a
  // delete, without re-fetching all four.
  useEffect(() => {
    setTabCounts((cur) => ({
      ...cur,
      [kind]: items.filter(
        (s) => !s.deleted && (s.status ?? "new") !== "done",
      ).length,
    }));
  }, [items, kind]);

  // Export the loaded submissions for the active kind to a CSV the director
  // can open in Excel/Sheets (e.g. to sort 196 team registrations into
  // divisions). Client-side from the already-fetched `items` — no new
  // endpoint. Columns are derived from the data so it works for any form
  // kind; the logo blob + internal/honeypot fields are dropped.
  function exportCsv() {
    if (items.length === 0) return;
    // "mailbox" is the normalized address used for flood control, not
    // something the office needs to read.
    const BLOCK = new Set(["id", "team_logo", "ip", "user_agent", "website", "mailbox"]);
    const keys = new Set<string>();
    for (const r of items) {
      for (const k of Object.keys(r)) if (!BLOCK.has(k)) keys.add(k);
    }
    // submitted_at + status lead; the rest alphabetical for a stable layout.
    const cols = [
      "submitted_at",
      "status",
      ...[...keys]
        .filter((k) => k !== "submitted_at" && k !== "status")
        .sort(),
    ];
    const esc = (v: unknown): string => {
      if (v == null) return "";
      const s = (typeof v === "object" ? JSON.stringify(v) : String(v))
        .replace(/\r?\n/g, " ")
        .trim();
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [
      cols.map(esc).join(","),
      ...items.map((r) => cols.map((k) => esc(r[k])).join(",")),
    ];
    // Leading BOM so Excel reads UTF-8 (accented names) correctly.
    const csv = "﻿" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${leagueId}-${kind}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={loading || items.length === 0}
            title="Download these submissions as a CSV (opens in Excel or Google Sheets)"
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Export CSV{items.length ? ` (${items.length})` : ""}
          </button>
          <button
            type="button"
            onClick={() => {
              fetchItems();
              fetchTabCounts();
            }}
            disabled={loading}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "…" : "Refresh"}
          </button>
        </div>
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
              "inline-flex items-center gap-1.5 " +
              (kind === t.key
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200")
            }
          >
            {t.label}
            {(tabCounts[t.key] ?? 0) > 0 && (
              <span
                aria-label={`${tabCounts[t.key]} waiting`}
                className={
                  "rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none " +
                  (kind === t.key
                    ? "bg-white text-slate-900"
                    : "bg-blue-600 text-white")
                }
              >
                {tabCounts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Status filter. Default "Actionable" (new + in_progress) so
          Adam opens admin and sees only what still needs work. The
          counts under the labels make the inbox queue visible at a
          glance without expanding any row. */}
      <StatusFilterBar
        items={items}
        active={filter}
        onChange={(f) => {
          setFilter(f);
          setExpanded(null);
        }}
      />

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
      ) : (() => {
          const filtered = filterItems(items, filter, statusOf);
          if (filtered.length === 0) {
            return (
              <p className="text-sm text-slate-500 italic">
                No submissions match the &ldquo;
                {filterLabel(filter)}&rdquo; filter. Switch to &ldquo;All&rdquo;
                to see every entry.
              </p>
            );
          }
          return (
            <ul className="divide-y divide-slate-200 border border-slate-200 rounded-md overflow-hidden">
              {filtered.map((it) => {
                const st = statusOf(it);
                const isDeleted = it.deleted === true;
                return (
                  <li
                    key={it.id}
                    className={
                      "text-xs " +
                      (isDeleted ? "bg-slate-50/60 opacity-70" : "")
                    }
                  >
                    <div className="px-3 py-2 hover:bg-slate-50 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((cur) =>
                            cur === it.id ? null : it.id,
                          )
                        }
                        className="flex-1 min-w-0 text-left flex items-center gap-2"
                      >
                        <span
                          className={
                            "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider border " +
                            (isDeleted
                              ? "bg-slate-200 text-slate-600 border-slate-300"
                              : STATUS_PILL[st])
                          }
                        >
                          {isDeleted ? (
                            <>🗑️ Deleted</>
                          ) : (
                            <>
                              <span aria-hidden>{STATUS_ICON[st]}</span>
                              {STATUS_LABEL[st]}
                            </>
                          )}
                        </span>
                        <span
                          className={
                            "flex-1 min-w-0 truncate font-semibold " +
                            (isDeleted
                              ? "text-slate-500 line-through"
                              : "text-slate-900")
                          }
                        >
                          {summaryLine(kind, it)}
                        </span>
                      </button>
                      {isDeleted ? (
                        <button
                          type="button"
                          onClick={() => setDeleted(it, false)}
                          disabled={busy === it.id}
                          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                        >
                          {busy === it.id ? "…" : "Restore"}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => advanceStatus(it)}
                            disabled={busy === it.id}
                            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                          >
                            {busy === it.id ? "…" : NEXT_LABEL[st]}
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleted(it, true)}
                            disabled={busy === it.id}
                            className="rounded border border-red-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
                            title="Soft delete — moves to the Deleted tab, can be restored."
                          >
                            Delete
                          </button>
                        </>
                      )}
                      <span className="text-[11px] text-slate-500 font-mono whitespace-nowrap">
                        {fmtTime(String(it.submitted_at ?? ""))}
                      </span>
                    </div>
                    {expanded === it.id && (
                      <>
                        <SubmissionDetail submission={it} />
                        {kind === "team_registration" && (
                          <TeamDivisionControl
                            leagueId={leagueId}
                            user={user}
                            submission={it}
                            teams={teams}
                            onSaved={(division) =>
                              setTeams((cur) =>
                                cur.map((t) =>
                                  t.id === String(it.assigned_team_id ?? "")
                                    ? { ...t, division }
                                    : t,
                                ),
                              )
                            }
                            onCreated={(teamId) =>
                              patchItem(it.id, { assigned_team_id: teamId })
                            }
                          />
                        )}
                        {kind === "player_registration" && (
                          <>
                            <FreeAgentDecision
                              leagueId={leagueId}
                              user={user}
                              submission={it}
                              onDecided={(status) =>
                                patchItem(it.id, { free_agent_status: status })
                              }
                            />
                            <AssignRegistration
                              leagueId={leagueId}
                              user={user}
                              submission={it}
                              teams={teams}
                              onAssigned={(playerId, teamId) =>
                                patchItem(it.id, {
                                  status: "done",
                                  assigned_player_id: playerId,
                                  assigned_team_id: teamId,
                                })
                              }
                            />
                          </>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          );
        })()}
    </section>
  );
}

// Assign a registered team to its division, from the registration itself.
//
// Doug reads the signup (team, age group, coach) and picks the division right
// there. The alternative was hunting the team down in the Teams tab and typing
// the division freehand, which is how you end up with "Division 1", "DIVISION
// 1" and "Div 1" as three different divisions.
//
// The dropdown offers divisions that already exist for that AGE GROUP, so the
// spelling stays consistent, with a free-text escape hatch for a genuinely new
// one. Teams are visible publicly either way (Doug, 2026-08-02: teams show as
// soon as they register); until this is set they read "Division TBD".
function TeamDivisionControl({
  leagueId,
  user,
  submission,
  teams,
  onSaved,
  onCreated,
}: {
  leagueId: string;
  user: User;
  submission: Submission;
  teams: { id: string; name: string; division: string; ageGroup: string }[];
  onSaved: (division: string) => void;
  onCreated: (teamId: string) => void;
}) {
  const teamId = String(submission.assigned_team_id ?? "");
  const team = teams.find((t) => t.id === teamId);
  const ageGroup = String(submission.age_group ?? team?.ageGroup ?? "");

  const [value, setValue] = useState(team?.division ?? "");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!teamId) {
    // Used to be a dead end reading "Create it on the Teams tab". A team typed
    // in by hand there is not connected to this registration, so the coach
    // never gets a sign-in code, their contact never reaches the Captains
    // view, and a card payment taken at signup stays filed under the
    // registration while the new team reads as owing its full fee.
    return <CreateTeamFromRegistration
      leagueId={leagueId}
      user={user}
      submission={submission}
      onCreated={onCreated}
    />;
  }

  // Divisions already in use at this age group, so 10U does not offer 14U's.
  const options = Array.from(
    new Set(
      teams
        .filter((t) => !ageGroup || t.ageGroup === ageGroup)
        .map((t) => t.division.trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  async function save() {
    const division = (value === "__new__" ? custom : value).trim();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin-team", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await user.getIdToken()}`,
        },
        body: JSON.stringify({
          leagueId,
          action: "update",
          teamId,
          division,
          ...(ageGroup ? { ageGroup } : {}),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setMsg(division ? `Assigned to ${division}` : "Division cleared");
      onSaved(division);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
        Division{ageGroup ? ` · ${ageGroup}` : ""}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
          className="rounded-md border border-slate-300 px-2 py-2 text-sm"
        >
          <option value="">Division TBD</option>
          {options.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
          <option value="__new__">Add a new division...</option>
        </select>
        {value === "__new__" && (
          <input
            type="text"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Division 1"
            disabled={busy}
            className="rounded-md border border-slate-300 px-2 py-2 text-sm"
          />
        )}
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save"}
        </button>
        {msg && <span className="text-xs text-slate-600">{msg}</span>}
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        {team?.name ? `${team.name} is live on the site now. ` : ""}
        Until a division is set it shows as Division TBD.
      </p>

      <PaymentQuickRecord
        leagueId={leagueId}
        user={user}
        teamId={teamId}
        submission={submission}
      />
    </div>
  );
}

// Record how a team paid without leaving the registration. The Payments tab
// still exists for the full ledger, but making the office switch tabs and
// hunt for the team 196 times is how reconciliation quietly stops happening.
// Card payments already mark themselves; these are for Venmo, check and cash.
function PaymentQuickRecord({
  leagueId,
  user,
  teamId,
  submission,
}: {
  leagueId: string;
  user: User;
  teamId: string;
  submission: Submission;
}) {
  const paidByCard =
    (submission.payment as { status?: string; method?: string } | undefined)
      ?.status === "paid";
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // What this team owes.
  //
  // This used to hardcode COYBL's insurance-option arithmetic with no tenant
  // check, so recording a Venmo or cheque payment for an ISLAND team wrote
  // $495 against a team that owes $795 — and then marked them paid in full,
  // $300 short, with nothing to show anything was wrong. feeFor is the same
  // function the card checkout uses, so the manual path and the card path can
  // no longer disagree.
  const due = feeFor(leagueId, submission as Record<string, unknown>);

  if (paidByCard) {
    return (
      <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        Paid by card. Recorded automatically, nothing to do.
      </p>
    );
  }

  async function record(method: "venmo" | "check" | "cash") {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin-team-payment", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await user.getIdToken()}`,
        },
        body: JSON.stringify({
          leagueId,
          action: "save",
          target: "team",
          teamId,
          amount_due: due,
          amount_paid: due,
          method,
          paid_at: new Date().toISOString(),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErr(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setDone(method);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not record it");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        Recorded ${due} paid by {done}.
      </p>
    );
  }

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
        Payment · ${due} due
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(["venmo", "check", "cash"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => record(m)}
            disabled={busy || !teamId}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
          >
            Mark paid by {m}
          </button>
        ))}
        {err && <span className="text-xs text-red-700">{err}</span>}
      </div>
    </div>
  );
}

// Filter pill row. Counts derived from the unfiltered list so even
// when the "Done" tab is empty Adam can see at a glance that 8
// total submissions exist.
function StatusFilterBar({
  items,
  active,
  onChange,
}: {
  items: Submission[];
  active: FilterMode;
  onChange: (f: FilterMode) => void;
}) {
  // Live items only — deleted submissions have their own bucket
  // and shouldn't pollute the status counts.
  const live = items.filter((s) => s.deleted !== true);
  const counts = {
    new: live.filter((s) => (s.status ?? "new") === "new").length,
    in_progress: live.filter((s) => s.status === "in_progress").length,
    done: live.filter((s) => s.status === "done").length,
  };
  const actionable = counts.new + counts.in_progress;
  const all = live.length;
  const deleted = items.filter((s) => s.deleted === true).length;

  // Filter labels use the same icons as the row pills so the bar
  // and the row state map 1:1 visually.
  const pills: { key: FilterMode; label: string; count: number }[] = [
    { key: "actionable", label: "Actionable", count: actionable },
    { key: "new", label: `${STATUS_ICON.new} New`, count: counts.new },
    {
      key: "in_progress",
      label: `${STATUS_ICON.in_progress} In progress`,
      count: counts.in_progress,
    },
    { key: "done", label: `${STATUS_ICON.done} Done`, count: counts.done },
    { key: "all", label: "All", count: all },
    { key: "deleted", label: "🗑️ Deleted", count: deleted },
  ];

  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {pills.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onChange(p.key)}
          className={
            "px-2.5 py-1 text-[11px] font-semibold rounded whitespace-nowrap flex items-center gap-1.5 " +
            (active === p.key
              ? "bg-slate-700 text-white"
              : "bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200")
          }
        >
          {p.label}
          <span
            className={
              "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold " +
              (active === p.key
                ? "bg-white/20 text-white"
                : "bg-slate-200 text-slate-700")
            }
          >
            {p.count}
          </span>
        </button>
      ))}
    </div>
  );
}

function filterItems(
  items: Submission[],
  filter: FilterMode,
  statusOf: (s: Submission) => Status,
): Submission[] {
  if (filter === "deleted") return items.filter((s) => s.deleted === true);
  // Every non-deleted filter excludes trashed items.
  const live = items.filter((s) => s.deleted !== true);
  if (filter === "all") return live;
  if (filter === "actionable") {
    return live.filter((s) => statusOf(s) !== "done");
  }
  return live.filter((s) => statusOf(s) === filter);
}

function filterLabel(f: FilterMode): string {
  if (f === "actionable") return "Actionable";
  if (f === "all") return "All";
  if (f === "deleted") return "Deleted";
  return STATUS_LABEL[f];
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
  if (kind === "player_waiver") {
    const player = `${s.player_first_name ?? ""} ${s.player_last_name ?? ""}`.trim();
    const parent = `${s.parent_first_name ?? ""} ${s.parent_last_name ?? ""}`.trim();
    const team = String(s.team_name ?? "");
    return [player || "(unnamed player)", team && `· ${team}`, parent && `· signed by ${parent}`]
      .filter(Boolean)
      .join(" ");
  }
  if (kind === "site_feedback") {
    // Lead with what they said, not who said it: the office is triaging by
    // problem here, and most of these arrive anonymously anyway.
    const topic = String(s.topic ?? "").trim();
    const msg = String(s.message ?? "").replace(/\s+/g, " ").trim();
    const who = String(s.name ?? "").trim();
    const short = msg.length > 80 ? msg.slice(0, 80) + "…" : msg;
    return [topic && `[${topic}]`, short || "(no message)", who && `— ${who}`]
      .filter(Boolean)
      .join(" ");
  }
  return s.id;
}

// Assign-to-team control for a player_registration submission.
// Creates a real roster player (+ private contact incl. DOB) via
// /api/admin-assign-registration and marks the submission done.
// Idempotent server-side: once assigned this just shows the link.
// Approve / reject a registration for the captains' free-agent pool.
// Approved → shows in /api/free-agents. Hidden until then (Adam,
// 2026-06). Assigning to a team (below) supersedes this.
function FreeAgentDecision({
  leagueId,
  user,
  submission,
  onDecided,
}: {
  leagueId: string;
  user: User;
  submission: Submission;
  onDecided: (status: "approved" | "rejected" | "pending") => void;
}) {
  const fa = String(submission.free_agent_status ?? "pending");
  const assigned =
    typeof submission.assigned_player_id === "string" &&
    !!submission.assigned_player_id;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "reject" | "pending") {
    setBusy(decision);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-free-agent", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, id: submission.id, decision }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      onDecided(
        decision === "approve"
          ? "approved"
          : decision === "reject"
            ? "rejected"
            : "pending",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const label = assigned
    ? "On a team"
    : fa === "approved"
      ? "✓ In free-agent pool"
      : fa === "rejected"
        ? "✕ Rejected"
        : "⏳ Pending approval";
  const labelColor = assigned
    ? "text-slate-500"
    : fa === "approved"
      ? "text-emerald-700"
      : fa === "rejected"
        ? "text-red-700"
        : "text-amber-700";

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold text-slate-700">
        Free-agent pool: <span className={labelColor}>{label}</span>
      </p>
      {!assigned && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => decide("approve")}
            disabled={busy !== null || fa === "approved"}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy === "approve" ? "…" : "✓ Approve as free agent"}
          </button>
          <button
            type="button"
            onClick={() => decide("reject")}
            disabled={busy !== null || fa === "rejected"}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {busy === "reject" ? "…" : "✕ Reject"}
          </button>
          {fa !== "pending" && (
            <button
              type="button"
              onClick={() => decide("pending")}
              disabled={busy !== null}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Undo
            </button>
          )}
        </div>
      )}
      <p className="mt-2 text-[11px] text-slate-500">
        Approved players appear in captains&rsquo; <strong>Free Agents</strong>{" "}
        tab. Or put them straight on a team below.
      </p>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function AssignRegistration({
  leagueId,
  user,
  submission,
  teams,
  onAssigned,
}: {
  leagueId: string;
  user: User;
  submission: Submission;
  teams: { id: string; name: string }[];
  onAssigned: (playerId: string, teamId: string) => void;
}) {
  const assignedPlayer =
    typeof submission.assigned_player_id === "string"
      ? submission.assigned_player_id
      : "";
  const assignedTeam =
    typeof submission.assigned_team_id === "string"
      ? submission.assigned_team_id
      : "";

  // Pre-select the team whose name matches what the registrant
  // requested, when there's an exact (case-insensitive) match.
  const requested =
    typeof submission.team_name === "string"
      ? submission.team_name.trim().toLowerCase()
      : "";
  const preselect =
    teams.find((t) => t.name.trim().toLowerCase() === requested)?.id ?? "";

  const [teamId, setTeamId] = useState(preselect);
  const [jersey, setJersey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const teamName = (id: string) =>
    teams.find((t) => t.id === id)?.name ?? id;

  if (assignedPlayer) {
    return (
      <div className="px-3 py-3 bg-emerald-50 border-t border-emerald-200 text-[12px] text-emerald-800">
        ✅ Added to the roster as{" "}
        <span className="font-mono">{assignedPlayer}</span>
        {assignedTeam ? <> on <strong>{teamName(assignedTeam)}</strong></> : null}
        . Their info (including birthdate) is on that team — visible to
        the team's captain/manager, never public.
      </div>
    );
  }

  async function assign() {
    if (!teamId) {
      setMsg({ ok: false, text: "Pick a team first." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-assign-registration", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          submissionId: submission.id,
          teamId,
          jersey: jersey.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        player_id?: string;
        team_id?: string;
        error?: string;
      };
      if (res.ok && data.ok && data.player_id) {
        setMsg({
          ok: true,
          text: `Added to ${teamName(data.team_id ?? teamId)}.`,
        });
        onAssigned(data.player_id, data.team_id ?? teamId);
      } else {
        setMsg({ ok: false, text: data.error ?? `HTTP ${res.status}` });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-3 py-3 bg-blue-50 border-t border-blue-200">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-800 mb-2">
        Add to a team's roster
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">
            Team
          </label>
          <select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-xs bg-white min-w-[180px]"
          >
            <option value="">— Select team —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">
            Jersey # (optional)
          </label>
          <input
            type="number"
            min={0}
            value={jersey}
            onChange={(e) => setJersey(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-xs w-[90px]"
            placeholder="#"
          />
        </div>
        <button
          type="button"
          onClick={assign}
          disabled={busy || !teamId}
          className="rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add to roster"}
        </button>
      </div>
      {msg && (
        <p
          className={
            "mt-2 text-[12px] " +
            (msg.ok ? "text-emerald-700" : "text-red-700")
          }
        >
          {msg.text}
        </p>
      )}
      <p className="mt-2 text-[11px] text-slate-500">
        Creates the player on the chosen team with their name,
        position, email, phone, and birthdate. Birthdate stays
        captain/admin-only — never shown publicly.
      </p>
    </div>
  );
}

// Render an expanded submission as a labeled table instead of raw JSON.
// Adam's feedback: "let make it actually lookk readable and nice." We
// turn snake_case keys into Title Case, format dates / phones / emails
// into tappable links, and prettify booleans. Unknown keys fall through
// to a plain string render rather than being dropped, so a future
// schema addition still appears (just without the prettifier).
function SubmissionDetail({ submission }: { submission: Submission }) {
  // Fields we never want to show in the body — already surfaced in the
  // row header (submitted_at + id) or pure plumbing.
  const HIDE = new Set(["id", "submitted_at"]);
  const entries = Object.entries(submission).filter(
    ([k]) => !HIDE.has(k),
  );
  return (
    <div className="px-3 py-3 bg-slate-50 border-t border-slate-200">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[12px]">
        {entries.map(([key, value]) => (
          <FieldRow key={key} fieldKey={key} value={value} />
        ))}
      </dl>
    </div>
  );
}

function FieldRow({
  fieldKey,
  value,
}: {
  fieldKey: string;
  value: unknown;
}) {
  const label = humanLabel(fieldKey);
  return (
    <>
      <dt className="text-slate-500 font-medium uppercase tracking-wider text-[10px] self-center">
        {label}
      </dt>
      <dd className="text-slate-900 break-words min-w-0">
        <FieldValue fieldKey={fieldKey} value={value} />
      </dd>
    </>
  );
}

function FieldValue({
  fieldKey,
  value,
}: {
  fieldKey: string;
  value: unknown;
}) {
  // Empty / missing → muted dash so the row doesn't look broken.
  if (value == null || value === "") {
    return <span className="text-slate-400">—</span>;
  }
  // Consent / waiver booleans get a real visual check, not just
  // "true". Other booleans fall through to the same treatment so
  // future yes/no fields don't need bespoke handling.
  if (typeof value === "boolean") {
    return value ? (
      <span className="text-emerald-700 font-semibold">✓ Yes</span>
    ) : (
      <span className="text-red-700 font-semibold">✗ No</span>
    );
  }
  if (typeof value === "string") {
    // Uploaded images are stored as base64 data URIs. Printed as text they
    // dump ~50KB of gibberish across the panel and bury every field under it.
    // Show the picture.
    if (/^data:image\//.test(value)) {
      const kb = Math.round((value.length * 0.75) / 1024);
      return (
        <span className="inline-flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Uploaded image"
            style={{
              maxWidth: 96,
              maxHeight: 96,
              objectFit: "contain",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              background: "#fff",
              padding: 2,
            }}
          />
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className="text-blue-700 underline-offset-2 hover:underline"
          >
            View full size ({kb} KB)
          </a>
        </span>
      );
    }

    // Coded answers are stored as machine values but must READ as English.
    // "option-1" told the office nothing about which fee a team owes.
    const CODED: Record<string, Record<string, string>> = {
      insurance_option: {
        "option-1": "$495 (league provides insurance)",
        "option-2": "$425 (team provides its own insurance)",
      },
      usssa_addon: { yes: "Yes, add USSSA (+$50)", no: "No" },
    };
    const decoded = CODED[fieldKey]?.[value];
    if (decoded) return <span>{decoded}</span>;

    // Email — open in the admin's mail client.
    if (fieldKey === "email" || /^email_/.test(fieldKey)) {
      return (
        <a
          href={`mailto:${value}`}
          className="text-blue-700 underline-offset-2 hover:underline break-all"
        >
          {value}
        </a>
      );
    }
    // Phone — tappable on mobile, normalized digits in the href.
    if (fieldKey === "phone" || /_phone$/.test(fieldKey)) {
      const digits = value.replace(/[^\d+]/g, "");
      return (
        <a
          href={`tel:${digits}`}
          className="text-blue-700 underline-offset-2 hover:underline"
        >
          {value}
        </a>
      );
    }
    // Date of birth / game_date / signed_on — display in a friendly
    // way and include age when we recognize a DOB.
    if (/^date_|_date$|^dob$/.test(fieldKey) || fieldKey === "game_date") {
      const friendly = formatDate(value);
      if (fieldKey === "dob") {
        const age = ageFromDob(value);
        return (
          <span>
            {friendly}
            {age != null && (
              <span className="text-slate-500 ml-2">({age} yo)</span>
            )}
          </span>
        );
      }
      return <span>{friendly}</span>;
    }
    // Position abbreviations get expanded so "C" isn't ambiguous.
    if (fieldKey === "primary_position") {
      return <span>{expandPosition(value)}</span>;
    }
    // Long notes / signatures — preserve newlines.
    if (
      fieldKey === "notes" ||
      fieldKey === "signature" ||
      fieldKey === "comments"
    ) {
      return <span className="whitespace-pre-wrap">{value}</span>;
    }
    return <span>{value}</span>;
  }
  if (typeof value === "number") {
    return <span>{value}</span>;
  }
  // The payment block. The generic JSON fallback below dumped this as a wall of
  // raw text — {"paid_at":"2026-08-12T03:03:27.849Z","receipt_url":… — across
  // four lines of the card. It is the single most important field on a paid
  // registration and it was the least readable thing on the page.
  if (
    fieldKey === "payment" &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const p = value as Record<string, unknown>;
    const cents = Number(p.amount_cents ?? 0);
    const when = typeof p.paid_at === "string" ? p.paid_at : "";
    const method = typeof p.method === "string" ? p.method : "";
    const receipt = typeof p.receipt_url === "string" ? p.receipt_url : "";
    const paid = p.status === "paid";
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={
            paid
              ? "rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700"
              : "rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500"
          }
        >
          {paid ? "Paid" : String(p.status ?? "unpaid")}
        </span>
        {cents > 0 && (
          <strong>
            {(cents / 100).toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
            })}
          </strong>
        )}
        {method && <span className="capitalize text-slate-600">{method}</span>}
        {when && (
          <span className="text-slate-600">
            {new Date(when).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        )}
        {receipt && (
          <a
            className="font-semibold text-blue-700 underline"
            href={receipt}
            target="_blank"
            rel="noopener noreferrer"
          >
            Receipt
          </a>
        )}
      </span>
    );
  }
  // Arrays / objects / anything else — show the JSON inline; rare
  // enough that a generic fallback is fine.
  return (
    <code className="text-[11px] text-slate-700">
      {JSON.stringify(value)}
    </code>
  );
}

function humanLabel(key: string): string {
  // Hand-overrides where the auto title-case looks off.
  const OVERRIDES: Record<string, string> = {
    dob: "Date of birth",
    primary_position: "Position",
    // NOT a signed waiver. The checkbox reads "I confirm that all players
    // and coaches will sign the league liability release before play", so
    // this is a promise to sign later. Calling it "Waiver agreed" implied the
    // league was holding a signed release it does not have.
    agreed_to_terms: "Accepted terms (release signed before play)",
    team_name: "Team",
    home_field_name: "Home field",
    home_field_street: "Field address",
    home_field_city: "Field city",
    home_field_zip: "Field ZIP",
    home_field_maps: "Field map",
    insurance_option: "Registration option",
    usssa_addon: "USSSA add-on",
    gamechanger_link: "GameChanger",
    assigned_team_id: "Team record",
    login_email_sent: "Login email sent",
    manager_first_name: "Manager first",
    manager_last_name: "Manager last",
    evaluator_name: "Evaluator",
    visiting_team: "Visiting team",
    home_team: "Home team",
  };
  if (OVERRIDES[key]) return OVERRIDES[key];
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(s: string): string {
  // Accept YYYY-MM-DD or full ISO. Render in en-US "May 11, 1992".
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!ymd) return s;
  const d = new Date(`${ymd[1]}-${ymd[2]}-${ymd[3]}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function ageFromDob(s: string): number | null {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!ymd) return null;
  const dob = new Date(`${ymd[1]}-${ymd[2]}-${ymd[3]}T12:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const before =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() &&
      now.getUTCDate() < dob.getUTCDate());
  if (before) age--;
  return age;
}

function expandPosition(code: string): string {
  const MAP: Record<string, string> = {
    P: "Pitcher",
    C: "Catcher",
    "1B": "First Base",
    "2B": "Second Base",
    "3B": "Third Base",
    SS: "Shortstop",
    LF: "Left Field",
    CF: "Center Field",
    RF: "Right Field",
    OF: "Outfield",
    IF: "Infield",
    DH: "Designated Hitter",
    UT: "Utility",
  };
  return MAP[code.toUpperCase()] ?? code;
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


// Create the team a registration is asking for, in one action.
//
// Island assigns teams by hand, so nothing creates them automatically the way
// COYBL's registration handler does. This calls the same provisioning code
// COYBL uses, so the team arrives complete: sign-in code minted, coach's login
// bound, contact details filed where the Captains view reads them, ledger
// seeded with what they owe, and any payment already taken moved off the
// registration and onto the team.
function CreateTeamFromRegistration({
  leagueId,
  user,
  submission,
  onCreated,
}: {
  leagueId: string;
  user: User;
  submission: Submission;
  onCreated: (teamId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  const teamName = String(submission.team_name ?? "").trim();
  const ageGroup = String(submission.age_group ?? "").trim();
  const division = String(submission.division ?? "").trim();
  const paid =
    (submission.payment as { status?: string } | undefined)?.status === "paid";

  async function create() {
    setBusy(true);
    setMsg(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-provision-team", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, submissionId: submission.id }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        teamId?: string;
        teamCode?: string | null;
      };
      if (!res.ok || !j.teamId) throw new Error(j.error ?? `HTTP ${res.status}`);
      setCode(j.teamCode ?? null);
      setMsg(`Created "${teamName}". It is on the Teams page now.`);
      onCreated(j.teamId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not create the team");
    } finally {
      setBusy(false);
    }
  }

  if (!teamName || !ageGroup) {
    return (
      <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        This registration has no {!teamName ? "team name" : "age group"}, so a
        team cannot be created from it.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-3">
      <p className="text-xs text-slate-700">
        No team on the site yet for this registration.
        {paid && (
          <strong className="text-emerald-700">
            {" "}
            They have already paid, so creating the team also files their
            payment against it.
          </strong>
        )}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        Will create <strong>{teamName}</strong>
        {ageGroup ? ` · ${ageGroup}` : ""}
        {division ? ` · ${division}` : ""}, mint their coach sign-in code and
        connect the coach&rsquo;s login.
      </p>
      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="mt-2 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create team from this registration"}
      </button>
      {msg && <p className="mt-2 text-xs font-semibold text-slate-800">{msg}</p>}
      {code && (
        <p className="mt-1 text-xs text-slate-700">
          Coach sign-in code: <code className="font-bold">{code}</code> — send
          this to {String(submission.email ?? "the coach")}.
        </p>
      )}
    </div>
  );
}

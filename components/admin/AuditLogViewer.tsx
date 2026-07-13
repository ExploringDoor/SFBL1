"use client";

// Admin audit log viewer. Lists recent /audit entries with the
// actor's email (instead of raw uid), filterable by kind.
//
// Today the only kind written is `schedule_edit` (from
// /api/captain-schedule). As more endpoints add audit writes — claim
// grants, payment edits, score overrides — they show up here
// automatically.
//
// Format per row: when, who (email + role), what kind, what fields
// changed (small JSON-ish summary).

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useTenant } from "@/lib/tenant-context";
import { captainNoun } from "@/lib/tenants";

interface AuditEntry {
  id: string;
  kind: string;
  by_uid: string | null;
  by_email: string | null;
  by_role: string | null;
  game_id: string | null;
  changes: Record<string, unknown>;
  at: string;
}

interface Props {
  leagueId: string;
  user: User;
}

const KIND_LABELS: Record<string, string> = {
  schedule_edit: "Schedule edit",
  schedule_create: "Game added",
  schedule_delete: "Game deleted",
  rain_out_day: "Rain-out day",
  alert_publish: "Banner published",
  alert_clear: "Banner cleared",
  walkon_approve: "Walk-on approved",
  walkon_reject: "Walk-on rejected",
  csv_schedule_import: "CSV schedule import",
  chat_moderate: "Chat message deleted",
  chat_clear_all: "Chat cleared",
  gcal_setup: "GCal sync enabled",
  gcal_sync_all: "GCal full reconcile",
  gcal_disable: "GCal sync disabled",
  score_quick_batch: "Scores batch-entered",
  score_resolve_conflict: "Score conflict resolved",
  sponsors_update: "Sponsors updated",
  bulk_invite: "Bulk captain invite",
  playoffs_update: "Playoff bracket updated",
  // future kinds (claim_grant, payment_edit, etc.) will fall back to
  // their raw key. Add labels here as needed.
};

// `bulk_invite` is the only audit kind whose display label names the
// team-manager role, so it renders through the tenant's configured noun
// (captainNoun). Stored `kind` values are unchanged — display only.
function kindLabel(kind: string, captain: string): string {
  if (kind === "bulk_invite") return `Bulk ${captain} invite`;
  return KIND_LABELS[kind] ?? kind;
}

export function AuditLogViewer({ leagueId, user }: Props) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<string>("");
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState<string | null>(null);
  const { config } = useTenant();
  const captain = captainNoun(config);

  const fetchLog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const params = new URLSearchParams({ leagueId, limit: "100" });
      if (kindFilter) params.set("kind", kindFilter);
      const res = await fetch(
        `/api/admin-audit-log?${params.toString()}`,
        { headers: { authorization: `Bearer ${idToken}` } },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { items?: AuditEntry[] };
      setEntries(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [user, leagueId, kindFilter]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  async function clearLog(olderThanDays: number | null) {
    const label =
      olderThanDays == null
        ? "EVERY audit entry for this league"
        : `entries older than ${olderThanDays} days`;
    if (
      !window.confirm(
        `Permanently delete ${label}? This can't be undone.`,
      )
    ) {
      return;
    }
    setClearing(true);
    setClearMsg(null);
    try {
      const idToken = await user.getIdToken();
      const params = new URLSearchParams({ leagueId });
      if (olderThanDays != null) {
        params.set("olderThanDays", String(olderThanDays));
      }
      const res = await fetch(
        `/api/admin-audit-log?${params.toString()}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${idToken}` },
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        deleted?: number;
        total_after?: number;
      };
      if (!res.ok) {
        setClearMsg(`Error: ${data.error ?? `HTTP ${res.status}`}`);
        return;
      }
      setClearMsg(
        `Deleted ${data.deleted ?? 0} entries. ${data.total_after ?? 0} remain.`,
      );
      await fetchLog();
    } catch (e) {
      setClearMsg(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setClearing(false);
    }
  }

  // Distinct kinds from current entries — drives the filter dropdown.
  // Includes the currently-selected kind even if no entries match
  // (so the filter doesn't disappear from itself).
  const availableKinds = [
    ...new Set([
      kindFilter,
      ...entries.map((e) => e.kind),
    ].filter(Boolean)),
  ].sort();

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="font-semibold text-slate-900">Audit log</p>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            Recent admin + {captain} actions: schedule edits, score
            overrides, role grants. Use this to verify "who changed
            that?" without digging into Firestore.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            disabled={loading}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="">All actions</option>
            {availableKinds.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k, captain)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={fetchLog}
            disabled={loading}
            className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => clearLog(30)}
            disabled={clearing || loading}
            title="Delete entries older than 30 days. Recent activity stays."
            className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
          >
            {clearing ? "…" : "Clear old"}
          </button>
          <button
            type="button"
            onClick={() => clearLog(null)}
            disabled={clearing || loading}
            title="Permanently delete every audit entry for this league."
            className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {clearing ? "…" : "Clear all"}
          </button>
        </div>
      </div>

      {clearMsg && (
        <p className="text-sm rounded bg-slate-50 px-2 py-1 border border-slate-200 text-slate-700">
          {clearMsg}
        </p>
      )}

      {error && (
        <p className="text-sm text-red-700 rounded bg-red-50 px-2 py-1 border border-red-200">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          {kindFilter
            ? `No ${kindLabel(kindFilter, captain)} entries yet.`
            : `No audit entries yet. ${captain} actions appear here.`}
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 border border-slate-200 rounded-md overflow-hidden">
          {entries.map((e) => (
            <li
              key={e.id}
              className="px-3 py-2 text-xs hover:bg-slate-50"
            >
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="font-semibold text-slate-900">
                    {kindLabel(e.kind, captain)}
                  </span>
                  {e.by_role && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-600 font-semibold">
                      {e.by_role}
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-slate-500 font-mono">
                  {fmtAuditTime(e.at)}
                </span>
              </div>
              <div className="mt-1 text-slate-700">
                <span className="text-slate-600">by </span>
                <span className="font-mono">
                  {e.by_email ?? e.by_uid ?? "system"}
                </span>
                {e.game_id && (
                  <>
                    {" "}
                    · game{" "}
                    <span className="font-mono">{e.game_id}</span>
                  </>
                )}
              </div>
              {Object.keys(e.changes).length > 0 && (
                <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-1.5 text-[11px] text-slate-800 font-mono">
                  {Object.entries(e.changes)
                    .filter(
                      ([k]) =>
                        k !== "updated_at" && k !== "updated_by_uid",
                    )
                    .map(([k, v]) => `${k}: ${formatVal(v)}`)
                    .join("  ·  ") || "(no field-level changes)"}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function fmtAuditTime(iso: string): string {
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
  return new Date(t).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatVal(v: unknown): string {
  if (v == null) return "null";
  if (typeof v === "string") return v.length > 30 ? v.slice(0, 27) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const j = JSON.stringify(v);
    return j.length > 50 ? j.slice(0, 47) + "…" : j;
  } catch {
    return "[obj]";
  }
}

"use client";

// Admin "Field Status" — set each field OPEN / WET / CLOSED for rain days
// so players can check their field before heading out. The public board
// (components/ui/FieldStatusBoard) shows only the non-open fields on the
// schedule page, and shows nothing when everything is open.
//
// Field list comes from the league's operational field list
// (leagues/{id}.fields — the same list the schedule editor's field picker
// uses), NOT site_config/fields (which is a separate address book). Status
// is stored at /leagues/{id}/site_config/field_status; admins can write
// site_config directly (firestore.rules), so no API route is needed —
// same pattern as FieldsManager.

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

type FieldState = "open" | "caution" | "closed";

interface Row {
  name: string;
  state: FieldState;
  note: string;
}

interface StoredStatus {
  state?: unknown;
  note?: unknown;
  at?: unknown;
}

const STATE_LABEL: Record<FieldState, string> = {
  open: "Open",
  caution: "Wet / caution",
  closed: "Closed / rained out",
};

interface Props {
  leagueId: string;
  user: User;
}

export function FieldStatusManager({ leagueId, user }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const db = getDb();
      const [leagueSnap, statusSnap] = await Promise.all([
        getDoc(doc(db, `leagues/${leagueId}`)),
        getDoc(doc(db, `leagues/${leagueId}/site_config/field_status`)),
      ]);
      const names: string[] = Array.isArray(leagueSnap.data()?.fields)
        ? (leagueSnap.data()!.fields as unknown[])
            .map((f) =>
              typeof f === "string"
                ? f
                : String((f as { name?: unknown })?.name ?? ""),
            )
            .filter(Boolean)
        : [];
      names.sort((a, b) => a.localeCompare(b));

      const stored = (statusSnap.data()?.statuses ?? {}) as Record<
        string,
        StoredStatus
      >;
      setRows(
        names.map((name) => {
          const s = stored[name];
          const state =
            s?.state === "closed" || s?.state === "caution"
              ? (s.state as FieldState)
              : "open";
          return {
            name,
            state,
            note: typeof s?.note === "string" ? s.note : "",
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  function patch(name: string, p: Partial<Row>) {
    setSaved(false);
    setRows((cur) => cur.map((r) => (r.name === name ? { ...r, ...p } : r)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const statuses: Record<
        string,
        { state: FieldState; note: string; at: string }
      > = {};
      for (const r of rows) {
        // Only persist fields that are flagged — an "open" field with no
        // note drops out of the map so the doc stays small and the public
        // board only ever iterates real problems.
        if (r.state !== "open" || r.note.trim()) {
          statuses[r.name] = {
            state: r.state,
            note: r.note.trim(),
            at: now,
          };
        }
      }
      await setDoc(
        doc(getDb(), `leagues/${leagueId}/site_config/field_status`),
        { statuses, updated_at: now, updated_by_uid: user.uid },
        { merge: false },
      );
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const flaggedCount = useMemo(
    () => rows.filter((r) => r.state !== "open").length,
    [rows],
  );

  async function allOpen() {
    setRows((cur) => cur.map((r) => ({ ...r, state: "open", note: "" })));
    setSaved(false);
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-900">Field Status</h2>
        <p className="text-sm text-slate-600">
          Set a field to <strong>Wet</strong> or <strong>Closed</strong> on a
          rain day. Flagged fields show at the top of the public{" "}
          <span className="font-mono">/schedule</span> page (with your note);
          when everything is Open, nothing shows. Fields come from your
          schedule field list.
        </p>
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {saved && (
        <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Saved. {flaggedCount === 0 ? "All fields open." : `${flaggedCount} field${flaggedCount === 1 ? "" : "s"} flagged.`}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading fields…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          No fields yet — add them in the <strong>Fields</strong> tab (or the
          schedule editor) first.
        </p>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save field status"}
            </button>
            <button
              type="button"
              onClick={allOpen}
              disabled={saving || flaggedCount === 0}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              Set all open (clear)
            </button>
          </div>

          <div className="overflow-hidden rounded-md border border-slate-200">
            {rows.map((r, i) => (
              <div
                key={r.name}
                className={
                  "flex flex-wrap items-center gap-2 px-3 py-2 " +
                  (i % 2 ? "bg-white" : "bg-slate-50") +
                  (r.state !== "open" ? " border-l-4 border-amber-500" : "")
                }
              >
                <span className="min-w-[160px] flex-1 text-sm font-semibold text-slate-900">
                  {r.name}
                </span>
                <select
                  value={r.state}
                  onChange={(e) =>
                    patch(r.name, { state: e.target.value as FieldState })
                  }
                  className="rounded border border-slate-300 px-2 py-1 text-sm"
                >
                  {(["open", "caution", "closed"] as FieldState[]).map((s) => (
                    <option key={s} value={s}>
                      {STATE_LABEL[s]}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={r.note}
                  onChange={(e) => patch(r.name, { note: e.target.value })}
                  placeholder="note (e.g. make-up TBD)"
                  disabled={r.state === "open"}
                  className="w-56 rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100"
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

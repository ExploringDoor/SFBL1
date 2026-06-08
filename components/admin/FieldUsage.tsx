"use client";

// Admin Field Usage tab — how many games each field has hosted.
// Counts games per `field` value: played (final/approved) vs still
// scheduled, sorted by most-played. Reads the public games
// collection client-side (Adam, 2026-05-18).

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface Props {
  leagueId: string;
  user: User;
}

interface FieldRow {
  field: string;
  played: number;
  scheduled: number;
  total: number;
}

export function FieldUsage({ leagueId }: Props) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [noField, setNoField] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const db = getDb();
      const snap = await getDocs(collection(db, `leagues/${leagueId}/games`));
      const map = new Map<string, FieldRow>();
      let missing = 0;
      for (const d of snap.docs) {
        const x = d.data();
        const field = String(x.field ?? "").trim();
        const status = String(x.status ?? "");
        if (status === "draft") continue;
        if (!field) {
          missing++;
          continue;
        }
        const r =
          map.get(field) ?? { field, played: 0, scheduled: 0, total: 0 };
        if (status === "final" || status === "approved") r.played++;
        else if (status === "scheduled") r.scheduled++;
        r.total++;
        map.set(field, r);
      }
      setRows(
        [...map.values()].sort(
          (a, b) => b.played - a.played || b.total - a.total,
        ),
      );
      setNoField(missing);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error)
    return (
      <p className="rounded bg-red-50 px-2 py-1 text-sm text-red-700">
        {error}
      </p>
    );

  const totalPlayed = rows.reduce((a, r) => a + r.played, 0);
  const maxPlayed = Math.max(1, ...rows.map((r) => r.played));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Games hosted at each field this season — most-played first.
        </p>
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm italic text-slate-500">
          No games with a field set yet.
        </p>
      ) : (
        <>
          <div className="overflow-hidden rounded-md border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2">Field</th>
                  <th className="px-3 py-2 text-right">Played</th>
                  <th className="px-3 py-2 text-right">Upcoming</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.field} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">{r.field}</div>
                      {/* usage bar */}
                      <div className="mt-1 h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-brand-primary"
                          style={{ width: `${(r.played / maxPlayed) * 100}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">
                      {r.played}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {r.scheduled}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {r.total}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                  <td className="px-3 py-2 text-slate-700">
                    {rows.length} field{rows.length === 1 ? "" : "s"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                    {totalPlayed}
                  </td>
                  <td className="px-3 py-2" colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
          {noField > 0 && (
            <p className="text-xs text-slate-400">
              {noField} game{noField === 1 ? "" : "s"} have no field assigned
              (not counted above).
            </p>
          )}
        </>
      )}
    </div>
  );
}

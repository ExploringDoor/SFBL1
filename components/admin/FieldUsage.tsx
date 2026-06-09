"use client";

// Admin Field Usage tab — games hosted per field, with a rate per
// game and a running rent total (Adam, 2026-05-18: "for an audit").
// Click a field to see every game played there (date + matchup).
//
// Rates are stored in /leagues/{id}/site_config/field_rates as
// { data: [{ field, rate }] }. Admin can write site_config directly
// (firestore.rules), so no API is needed. Games + teams are public
// reads.

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface Props {
  leagueId: string;
  user: User;
}

interface GameLite {
  date: string | null;
  label: string; // "Away @ Home"
  status: string;
}
interface FieldRow {
  field: string;
  played: number;
  total: number;
  games: GameLite[];
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function fmtDate(iso: string | null): string {
  if (!iso) return "TBD";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

export function FieldUsage({ leagueId, user }: Props) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedField, setSavedField] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const db = getDb();
      const [gamesSnap, teamsSnap, ratesDoc] = await Promise.all([
        getDocs(collection(db, `leagues/${leagueId}/games`)),
        getDocs(collection(db, `leagues/${leagueId}/teams`)),
        getDoc(doc(db, `leagues/${leagueId}/site_config/field_rates`)),
      ]);
      const tn: Record<string, string> = {};
      for (const d of teamsSnap.docs) tn[d.id] = String(d.data().name ?? d.id);

      const map = new Map<string, FieldRow>();
      for (const d of gamesSnap.docs) {
        const x = d.data();
        const field = String(x.field ?? "").trim();
        const status = String(x.status ?? "");
        if (status === "draft" || !field) continue;
        const r = map.get(field) ?? { field, played: 0, total: 0, games: [] };
        const isPlayed = status === "final" || status === "approved";
        if (isPlayed) r.played++;
        r.total++;
        r.games.push({
          date: x.date ? String(x.date) : null,
          label: `${tn[String(x.away_team_id ?? "")] ?? x.away_team_id ?? "?"} @ ${
            tn[String(x.home_team_id ?? "")] ?? x.home_team_id ?? "?"
          }`,
          status,
        });
        map.set(field, r);
      }
      for (const r of map.values())
        r.games.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
      setRows(
        [...map.values()].sort(
          (a, b) => b.played - a.played || b.total - a.total,
        ),
      );

      const data = ratesDoc.exists() ? ratesDoc.data() : null;
      const rmap: Record<string, number> = {};
      if (Array.isArray(data?.data)) {
        for (const e of data!.data as unknown[]) {
          const o = (e ?? {}) as Record<string, unknown>;
          const f = String(o.field ?? "");
          const rate = Number(o.rate ?? 0);
          if (f && Number.isFinite(rate)) rmap[f] = rate;
        }
      }
      setRates(rmap);
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

  async function saveRate(field: string, rate: number) {
    setRates((r) => ({ ...r, [field]: rate }));
    try {
      const next = { ...rates, [field]: rate };
      const dataArr = Object.entries(next).map(([f, rt]) => ({
        field: f,
        rate: rt,
      }));
      await setDoc(
        doc(getDb(), `leagues/${leagueId}/site_config/field_rates`),
        { data: dataArr, updated_at: new Date().toISOString() },
        { merge: true },
      );
      setSavedField(field);
      setTimeout(() => setSavedField(null), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error)
    return (
      <p className="rounded bg-red-50 px-2 py-1 text-sm text-red-700">{error}</p>
    );

  const grandTotal = rows.reduce(
    (a, r) => a + (rates[r.field] ?? 0) * r.played,
    0,
  );
  const totalPlayed = rows.reduce((a, r) => a + r.played, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-600">
          Games hosted per field. Set a <strong>rate per game</strong> to see
          rent totals; click a field to audit every game played there.
        </p>
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card label="Games played" value={String(totalPlayed)} />
        <Card label="Fields used" value={String(rows.length)} />
        <Card label="Total rent" value={money(grandTotal)} tone="emerald" />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm italic text-slate-500">
          No games with a field set yet.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const rate = rates[r.field] ?? 0;
            const open = expanded === r.field;
            return (
              <div
                key={r.field}
                className="overflow-hidden rounded-md border border-slate-200"
              >
                <div className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : r.field)}
                    className="flex-1 min-w-[160px] text-left"
                  >
                    <span className="font-semibold text-slate-900">
                      {open ? "▾ " : "▸ "}
                      {r.field}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      {r.played} played
                      {r.total > r.played ? ` · ${r.total - r.played} upcoming` : ""}
                    </span>
                  </button>
                  <label className="flex items-center gap-1 text-xs text-slate-600">
                    Rate&nbsp;$
                    <input
                      type="number"
                      min={0}
                      value={rate || ""}
                      onChange={(e) =>
                        setRates((rr) => ({
                          ...rr,
                          [r.field]: Number(e.target.value) || 0,
                        }))
                      }
                      onBlur={(e) =>
                        saveRate(r.field, Number(e.target.value) || 0)
                      }
                      placeholder="0"
                      className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                    /game
                  </label>
                  <span className="w-24 text-right text-sm font-bold tabular-nums text-slate-900">
                    {money(rate * r.played)}
                  </span>
                  {savedField === r.field && (
                    <span className="text-[10px] font-semibold text-emerald-600">
                      saved
                    </span>
                  )}
                </div>
                {open && (
                  <ul className="border-t border-slate-100 bg-slate-50/60 text-sm">
                    {r.games.map((g, i) => (
                      <li
                        key={i}
                        className="flex justify-between gap-3 border-t border-slate-100 px-4 py-1.5 first:border-t-0"
                      >
                        <span className="text-slate-700">{g.label}</span>
                        <span className="whitespace-nowrap text-slate-500">
                          {fmtDate(g.date)}
                          {g.status !== "final" && g.status !== "approved" ? (
                            <em className="ml-2 text-amber-600">({g.status})</em>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Card({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "emerald";
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p
        className={
          "mt-1 text-lg font-bold " +
          (tone === "emerald" ? "text-emerald-700" : "text-slate-900")
        }
      >
        {value}
      </p>
    </div>
  );
}

"use client";

// Admin Payments tab — league-wide view of fee collection. Captains
// track their own team's payments in the captain portal
// (/api/captain-payment writes /leagues/{id}/payments/{playerId});
// this rolls them all up for the commissioner: a per-team breakdown
// + a league total.
//
// Reads are client-side: payments are admin-readable per
// firestore.rules; players + teams are public. We join on player_id
// / team_id (names only — no PII pulled here).

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface Props {
  leagueId: string;
  user: User;
}

interface Pay {
  player_id: string;
  team_id: string;
  amount_paid: number;
  amount_due: number;
  paid: boolean;
  note: string;
}

function statusOf(p: Pay): "paid" | "partial" | "unpaid" {
  if (p.amount_due <= 0) return p.paid ? "paid" : "unpaid";
  if (p.amount_paid >= p.amount_due) return "paid";
  if (p.amount_paid > 0) return "partial";
  return "unpaid";
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function PaymentsAdmin({ leagueId }: Props) {
  const [loading, setLoading] = useState(true);
  const [pays, setPays] = useState<Pay[]>([]);
  const [playerName, setPlayerName] = useState<Record<string, string>>({});
  const [teamName, setTeamName] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const db = getDb();
      const [paySnap, playerSnap, teamSnap] = await Promise.all([
        getDocs(collection(db, `leagues/${leagueId}/payments`)),
        getDocs(collection(db, `leagues/${leagueId}/players`)),
        getDocs(collection(db, `leagues/${leagueId}/teams`)),
      ]);
      const pn: Record<string, string> = {};
      for (const d of playerSnap.docs) pn[d.id] = String(d.data().name ?? d.id);
      const tn: Record<string, string> = {};
      for (const d of teamSnap.docs) tn[d.id] = String(d.data().name ?? d.id);
      setPlayerName(pn);
      setTeamName(tn);
      setPays(
        paySnap.docs.map((d) => {
          const x = d.data();
          return {
            player_id: String(x.player_id ?? d.id),
            team_id: String(x.team_id ?? ""),
            amount_paid: Number(x.amount_paid ?? 0),
            amount_due: Number(x.amount_due ?? 0),
            paid: x.paid === true,
            note: String(x.note ?? ""),
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

  const totalCollected = pays.reduce((a, p) => a + p.amount_paid, 0);
  const totalDue = pays.reduce((a, p) => a + p.amount_due, 0);
  const outstanding = Math.max(0, totalDue - totalCollected);
  const paidCount = pays.filter((p) => statusOf(p) === "paid").length;

  // Group by team.
  const byTeam = new Map<string, Pay[]>();
  for (const p of pays) {
    const arr = byTeam.get(p.team_id) ?? [];
    arr.push(p);
    byTeam.set(p.team_id, arr);
  }
  const teamRows = [...byTeam.entries()].sort((a, b) =>
    (teamName[a[0]] ?? a[0]).localeCompare(teamName[b[0]] ?? b[0]),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          League-wide fee collection. Captains update these from their
          portal; this is your read-only roll-up.
        </p>
        <button
          type="button"
          onClick={load}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Collected" value={money(totalCollected)} tone="emerald" />
        <SummaryCard label="Outstanding" value={money(outstanding)} tone="amber" />
        <SummaryCard label="Players paid" value={`${paidCount} / ${pays.length}`} />
        <SummaryCard label="Total billed" value={money(totalDue)} />
      </div>

      {pays.length === 0 ? (
        <p className="text-sm italic text-slate-500">
          No payment records yet. They appear once captains start tracking
          fees in their portal.
        </p>
      ) : (
        teamRows.map(([teamId, rows]) => {
          const tCollected = rows.reduce((a, p) => a + p.amount_paid, 0);
          const tPaid = rows.filter((p) => statusOf(p) === "paid").length;
          return (
            <div
              key={teamId}
              className="overflow-hidden rounded-md border border-slate-200"
            >
              <div className="flex items-center justify-between bg-slate-50 px-3 py-2">
                <span className="text-sm font-semibold text-slate-900">
                  {teamName[teamId] ?? teamId}
                </span>
                <span className="text-xs text-slate-600">
                  {tPaid}/{rows.length} paid · {money(tCollected)} collected
                </span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {rows
                    .sort((a, b) =>
                      (playerName[a.player_id] ?? a.player_id).localeCompare(
                        playerName[b.player_id] ?? b.player_id,
                      ),
                    )
                    .map((p) => {
                      const st = statusOf(p);
                      return (
                        <tr key={p.player_id} className="border-t border-slate-100">
                          <td className="px-3 py-1.5">
                            {playerName[p.player_id] ?? p.player_id}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                            {money(p.amount_paid)}
                            {p.amount_due > 0 ? ` / ${money(p.amount_due)}` : ""}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <span
                              className={
                                "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase " +
                                (st === "paid"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : st === "partial"
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-slate-100 text-slate-500")
                              }
                            >
                              {st}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-xs text-slate-500">
                            {p.note}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "amber";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "amber"
        ? "text-amber-700"
        : "text-slate-900";
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className={"mt-1 text-lg font-bold " + color}>{value}</p>
    </div>
  );
}

"use client";

// Admin Payments tab — the LEAGUE's ledger of what each team owes /
// has paid the league (dues, fees). This is the commissioner's own
// tracking, fully separate from /api/captain-payment (captains
// tracking their own players' money — never shown here).
//
// Reads + writes via /api/admin-team-payment (Admin SDK). Team names
// come from the public teams collection.

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface Props {
  leagueId: string;
  user: User;
}

interface Row {
  team_id: string;
  name: string;
  amount_due: string; // kept as strings for the inputs
  amount_paid: string;
  note: string;
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function statusOf(due: number, paid: number): "paid" | "partial" | "unpaid" {
  if (due > 0 && paid >= due) return "paid";
  if (paid > 0) return "partial";
  return "unpaid";
}

export function PaymentsAdmin({ leagueId, user }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const idToken = await user.getIdToken();
      const [teamSnap, payRes] = await Promise.all([
        getDocs(collection(getDb(), `leagues/${leagueId}/teams`)),
        fetch("/api/admin-team-payment", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ leagueId, action: "list" }),
        }),
      ]);
      const payBody = (await payRes.json().catch(() => ({}))) as {
        payments?: {
          team_id: string;
          amount_due: number;
          amount_paid: number;
          note: string;
        }[];
      };
      const payById = new Map(
        (payBody.payments ?? []).map((p) => [p.team_id, p]),
      );
      const teamRows: Row[] = teamSnap.docs
        .filter((d) => d.data().active !== false)
        .map((d) => {
          const p = payById.get(d.id);
          return {
            team_id: d.id,
            name: String(d.data().name ?? d.id),
            amount_due: p?.amount_due ? String(p.amount_due) : "",
            amount_paid: p?.amount_paid ? String(p.amount_paid) : "",
            note: p?.note ?? "",
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      setRows(teamRows);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Load failed" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  function patch(teamId: string, field: keyof Row, value: string) {
    setRows((rs) =>
      rs.map((r) => (r.team_id === teamId ? { ...r, [field]: value } : r)),
    );
  }

  async function save(r: Row) {
    setSavingId(r.team_id);
    setMsg(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-team-payment", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          action: "save",
          teamId: r.team_id,
          amount_due: r.amount_due === "" ? 0 : Number(r.amount_due),
          amount_paid: r.amount_paid === "" ? 0 : Number(r.amount_paid),
          note: r.note,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) setMsg({ ok: true, text: `Saved ${r.name}.` });
      else setMsg({ ok: false, text: data.error ?? `HTTP ${res.status}` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setSavingId(null);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  const totDue = rows.reduce((a, r) => a + (Number(r.amount_due) || 0), 0);
  const totPaid = rows.reduce((a, r) => a + (Number(r.amount_paid) || 0), 0);
  const outstanding = Math.max(0, totDue - totPaid);
  const paidTeams = rows.filter(
    (r) => statusOf(Number(r.amount_due) || 0, Number(r.amount_paid) || 0) === "paid",
  ).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Track what each <strong>team</strong> owes and has paid the league.
        This is your own ledger — captains&rsquo; player payments are not
        shown here.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Collected" value={money(totPaid)} tone="emerald" />
        <Card label="Outstanding" value={money(outstanding)} tone="amber" />
        <Card label="Teams paid" value={`${paidTeams} / ${rows.length}`} />
        <Card label="Total billed" value={money(totDue)} />
      </div>

      {msg && (
        <p
          className={
            "rounded-md px-2 py-1 text-sm " +
            (msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")
          }
        >
          {msg.text}
        </p>
      )}

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2">Team</th>
              <th className="px-3 py-2 w-28">Paid ($)</th>
              <th className="px-3 py-2 w-28">Due ($)</th>
              <th className="px-3 py-2">Note</th>
              <th className="px-3 py-2 w-20">Status</th>
              <th className="px-3 py-2 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = statusOf(
                Number(r.amount_due) || 0,
                Number(r.amount_paid) || 0,
              );
              return (
                <tr key={r.team_id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 font-medium text-slate-900">
                    {r.name}
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number"
                      min={0}
                      value={r.amount_paid}
                      onChange={(e) =>
                        patch(r.team_id, "amount_paid", e.target.value)
                      }
                      className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                      placeholder="0"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number"
                      min={0}
                      value={r.amount_due}
                      onChange={(e) =>
                        patch(r.team_id, "amount_due", e.target.value)
                      }
                      className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                      placeholder="0"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={r.note}
                      onChange={(e) => patch(r.team_id, "note", e.target.value)}
                      className="w-full min-w-[120px] rounded border border-slate-300 px-2 py-1 text-sm"
                      placeholder="Zelle 5/2, owes balance…"
                    />
                  </td>
                  <td className="px-3 py-1.5">
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
                  <td className="px-3 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => save(r)}
                      disabled={savingId === r.team_id}
                      className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {savingId === r.team_id ? "…" : "Save"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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

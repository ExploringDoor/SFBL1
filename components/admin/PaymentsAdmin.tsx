"use client";

// Admin Payments tab — the LEAGUE's ledger of who has paid the
// league. Adam: it happens both ways, so track BOTH:
//   - team-level (a team pays as a block)
//   - player-level (a player pays the league directly)
// Separate from /api/captain-payment (captains tracking their own
// players' money) — none of that is shown here.
//
// team-level → team_payments/{teamId}; player-level →
// league_payments/{playerId}, both via /api/admin-team-payment.
// Team + player names come from the public collections.

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface Props {
  leagueId: string;
  user: User;
}

interface Entry {
  amount_paid: string;
  note: string;
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function PaymentsAdmin({ leagueId, user }: Props) {
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [playersByTeam, setPlayersByTeam] = useState<
    Record<string, { id: string; name: string }[]>
  >({});
  const [teamPay, setTeamPay] = useState<Record<string, Entry>>({});
  const [playerPay, setPlayerPay] = useState<Record<string, Entry>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    setLoading(true);
    setMsg(null);
    try {
      const db = getDb();
      const idToken = await user.getIdToken();
      const [teamSnap, playerSnap, payRes] = await Promise.all([
        getDocs(collection(db, `leagues/${leagueId}/teams`)),
        getDocs(collection(db, `leagues/${leagueId}/players`)),
        fetch("/api/admin-team-payment", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ leagueId, action: "list" }),
        }),
      ]);

      setTeams(
        teamSnap.docs
          .filter((d) => d.data().active !== false)
          .map((d) => ({ id: d.id, name: String(d.data().name ?? d.id) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );

      const pbt: Record<string, { id: string; name: string }[]> = {};
      for (const d of playerSnap.docs) {
        const x = d.data();
        if (x.active === false || x.orphan === true) continue;
        if (x.status && x.status !== "active") continue;
        const tid = String(x.team_id ?? "");
        if (!tid) continue;
        (pbt[tid] ??= []).push({ id: d.id, name: String(x.name ?? d.id) });
      }
      for (const arr of Object.values(pbt))
        arr.sort((a, b) => a.name.localeCompare(b.name));
      setPlayersByTeam(pbt);

      const body = (await payRes.json().catch(() => ({}))) as {
        team_payments?: { team_id: string; amount_paid: number; note: string }[];
        player_payments?: {
          player_id: string;
          amount_paid: number;
          note: string;
        }[];
      };
      const tp: Record<string, Entry> = {};
      for (const p of body.team_payments ?? [])
        tp[p.team_id] = {
          amount_paid: p.amount_paid ? String(p.amount_paid) : "",
          note: p.note ?? "",
        };
      setTeamPay(tp);
      const pp: Record<string, Entry> = {};
      for (const p of body.player_payments ?? [])
        pp[p.player_id] = {
          amount_paid: p.amount_paid ? String(p.amount_paid) : "",
          note: p.note ?? "",
        };
      setPlayerPay(pp);
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

  async function save(
    target: "team" | "player",
    id: string,
    teamId: string,
    entry: Entry,
  ) {
    setSaving(`${target}:${id}`);
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
          target,
          ...(target === "team" ? { teamId: id } : { playerId: id, teamId }),
          amount_paid: entry.amount_paid === "" ? 0 : Number(entry.amount_paid),
          note: entry.note,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) setMsg({ ok: true, text: "Saved." });
      else setMsg({ ok: false, text: data.error ?? `HTTP ${res.status}` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  const teamTotal = Object.values(teamPay).reduce(
    (a, e) => a + (Number(e.amount_paid) || 0),
    0,
  );
  const playerTotal = Object.values(playerPay).reduce(
    (a, e) => a + (Number(e.amount_paid) || 0),
    0,
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Track who&rsquo;s paid the <strong>league</strong> — a team paying as a
        block, or players paying directly (both happen). This is your ledger;
        captains&rsquo; own player tracking isn&rsquo;t shown here.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card label="Team payments" value={money(teamTotal)} />
        <Card label="Player payments" value={money(playerTotal)} />
        <Card label="Total collected" value={money(teamTotal + playerTotal)} tone="emerald" />
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

      <div className="space-y-2">
        {teams.map((t) => {
          const roster = playersByTeam[t.id] ?? [];
          const tEntry = teamPay[t.id] ?? { amount_paid: "", note: "" };
          const open = expanded === t.id;
          const playerPaidCount = roster.filter(
            (p) => Number(playerPay[p.id]?.amount_paid) > 0,
          ).length;
          return (
            <div key={t.id} className="overflow-hidden rounded-md border border-slate-200">
              {/* Team-level row */}
              <div className="flex flex-wrap items-center gap-2 bg-slate-50 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : t.id)}
                  className="flex-1 min-w-[150px] text-left text-sm font-semibold text-slate-900"
                >
                  {open ? "▾ " : "▸ "}
                  {t.name}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {roster.length} players · {playerPaidCount} paid
                  </span>
                </button>
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  Team paid&nbsp;$
                  <input
                    type="number"
                    min={0}
                    value={tEntry.amount_paid}
                    onChange={(e) =>
                      setTeamPay((m) => ({
                        ...m,
                        [t.id]: { ...tEntry, amount_paid: e.target.value },
                      }))
                    }
                    placeholder="0"
                    className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
                <input
                  type="text"
                  value={tEntry.note}
                  onChange={(e) =>
                    setTeamPay((m) => ({
                      ...m,
                      [t.id]: { ...tEntry, note: e.target.value },
                    }))
                  }
                  placeholder="note (Zelle 5/2…)"
                  className="w-40 rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  onClick={() => save("team", t.id, t.id, tEntry)}
                  disabled={saving === `team:${t.id}`}
                  className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {saving === `team:${t.id}` ? "…" : "Save"}
                </button>
              </div>

              {/* Player-level rows */}
              {open && (
                <div className="divide-y divide-slate-100">
                  {roster.length === 0 ? (
                    <p className="px-4 py-2 text-xs italic text-slate-500">
                      No players on this roster.
                    </p>
                  ) : (
                    roster.map((p) => {
                      const e = playerPay[p.id] ?? { amount_paid: "", note: "" };
                      return (
                        <div
                          key={p.id}
                          className="flex flex-wrap items-center gap-2 px-4 py-1.5"
                        >
                          <span className="flex-1 min-w-[140px] text-sm text-slate-800">
                            {p.name}
                          </span>
                          <label className="flex items-center gap-1 text-xs text-slate-500">
                            $
                            <input
                              type="number"
                              min={0}
                              value={e.amount_paid}
                              onChange={(ev) =>
                                setPlayerPay((m) => ({
                                  ...m,
                                  [p.id]: { ...e, amount_paid: ev.target.value },
                                }))
                              }
                              placeholder="0"
                              className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
                            />
                          </label>
                          <input
                            type="text"
                            value={e.note}
                            onChange={(ev) =>
                              setPlayerPay((m) => ({
                                ...m,
                                [p.id]: { ...e, note: ev.target.value },
                              }))
                            }
                            placeholder="note"
                            className="w-32 rounded border border-slate-300 px-2 py-1 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => save("player", p.id, t.id, e)}
                            disabled={saving === `player:${p.id}`}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                          >
                            {saving === `player:${p.id}` ? "…" : "Save"}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
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

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
  /** What this team owes, seeded from their registration option. */
  amount_due: string;
  note: string;
  /** "card" | "venmo" | "check" | "cash" | "" — how the money arrived. */
  method: string;
  /** ISO timestamp, set automatically when a payment is recorded. */
  paid_at: string;
  /** Square's own receipt page, on card rows. Proof of payment without
   *  logging in to Square. */
  receipt_url: string;
  /** When the office last emailed this team about the money. */
  reminder_sent_at: string;
}

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Reads a payment at a glance: "Card · Aug 4" instead of a sentence like
 *  "Paid by card 2026-08-04 (includes card fee)" sitting in a note column. */
function PaidBadge({
  entry,
}: {
  entry: { amount_paid: string; method: string; paid_at: string };
}) {
  const paid = Number(entry.amount_paid) > 0;
  if (!paid) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        Unpaid
      </span>
    );
  }
  const label: Record<string, string> = {
    card: "Card",
    venmo: "Venmo",
    check: "Check",
    cash: "Cash",
    other: "Other",
  };
  // Exact moment, not just a day. Adam wants to be able to match a card
  // payment against the Square dashboard without guessing.
  const when = entry.paid_at
    ? new Date(entry.paid_at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const how = label[entry.method] ?? "";
  return (
    <span
      className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700"
      title={when ? `Paid ${when}` : undefined}
    >
      Paid{how ? ` · ${how}` : ""}
      {when ? ` · ${when}` : ""}
    </span>
  );
}

export function PaymentsAdmin({ leagueId, user }: Props) {
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState<
    { id: string; name: string; ageGroup: string; ageOrder: number }[]
  >([]);
  const [playersByTeam, setPlayersByTeam] = useState<
    Record<string, { id: string; name: string }[]>
  >({});
  const [teamPay, setTeamPay] = useState<Record<string, Entry>>({});
  const [playerPay, setPlayerPay] = useState<Record<string, Entry>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  // Doug works one age group at a time and chases the unpaid. 196 teams in one
  // flat list is unusable without these.
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"all" | "unpaid" | "paid">("all");
  const [saving, setSaving] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
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
          .map((d) => ({
            id: d.id,
            name: String(d.data().name ?? d.id),
            ageGroup: String(d.data().ageGroup ?? ""),
            ageOrder:
              typeof d.data().ageOrder === "number"
                ? (d.data().ageOrder as number)
                : 999,
          }))
          // Age first (7U before 14U), then name. Doug works an age group at
          // a time, so a flat alphabetical list of 196 teams was unusable.
          .sort(
            (a, b) =>
              a.ageOrder - b.ageOrder ||
              a.ageGroup.localeCompare(b.ageGroup) ||
              a.name.localeCompare(b.name),
          ),
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
        team_payments?: {
        team_id: string;
        amount_due?: number;
        amount_paid: number;
        note: string;
        method?: string;
        paid_at?: string;
        receipt_url?: string;
        reminder_sent_at?: string;
      }[];
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
          amount_due: p.amount_due ? String(p.amount_due) : "",
          note: p.note ?? "",
          method: (p as { method?: string }).method ?? "",
          paid_at: (p as { paid_at?: string }).paid_at ?? "",
          receipt_url: p.receipt_url ?? "",
          reminder_sent_at: p.reminder_sent_at ?? "",
        };
      setTeamPay(tp);
      const pp: Record<string, Entry> = {};
      for (const p of body.player_payments ?? [])
        pp[p.player_id] = {
          amount_paid: p.amount_paid ? String(p.amount_paid) : "",
          amount_due: "",
          note: p.note ?? "",
          method: "",
          paid_at: "",
          receipt_url: "",
          reminder_sent_at: "",
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
          ...(entry.amount_due !== "" ? { amount_due: Number(entry.amount_due) } : {}),
          note: entry.note,
          method: entry.method,
          // Stamp WHEN it was recorded, so the row can read "Paid · Venmo ·
          // Aug 4" without anyone typing a date. Only set once there is money
          // against the row; clearing an amount clears the date with it.
          paid_at:
            Number(entry.amount_paid) > 0
              ? entry.paid_at || new Date().toISOString()
              : "",
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

  // How many teams have settled, and what is still outstanding across the
  // league. "Total collected" alone does not tell Doug who to chase.
  const teamsPaidCount = teams.filter(
    (t) => Number(teamPay[t.id]?.amount_paid ?? 0) > 0,
  ).length;
  const outstanding = teams.reduce((sum, t) => {
    const e = teamPay[t.id];
    const due = Number(e?.amount_due ?? 0);
    const paid = Number(e?.amount_paid ?? 0);
    return sum + Math.max(0, due - paid);
  }, 0);

  // Per age-group totals, so Doug can see which age group is lagging without
  // adding up rows himself. Keyed off the same list that renders, so the
  // numbers always match what is on screen.
  const ageTotals = new Map<
    string,
    { teams: number; paid: number; owed: number }
  >();
  for (const t of teams) {
    const k = t.ageGroup || "No age group";
    const e = teamPay[t.id];
    const cur = ageTotals.get(k) ?? { teams: 0, paid: 0, owed: 0 };
    cur.teams += 1;
    if (Number(e?.amount_paid ?? 0) > 0) cur.paid += 1;
    cur.owed += Math.max(
      0,
      Number(e?.amount_due ?? 0) - Number(e?.amount_paid ?? 0),
    );
    ageTotals.set(k, cur);
  }

  const needle = query.trim().toLowerCase();
  const visibleTeams = teams.filter((t) => {
    if (needle && !t.name.toLowerCase().includes(needle)) return false;
    const paid = Number(teamPay[t.id]?.amount_paid ?? 0) > 0;
    if (show === "paid") return paid;
    if (show === "unpaid") return !paid;
    return true;
  });

  /** Download what is currently on screen, for the treasurer's books. */
  function exportCsv() {
    const rows = [
      [
        "Age group",
        "Team",
        "Amount due",
        "Amount paid",
        "Balance",
        "Method",
        "Paid at",
        "Receipt",
        "Note",
      ],
      ...visibleTeams.map((t) => {
        const e = teamPay[t.id];
        const due = Number(e?.amount_due ?? 0);
        const paid = Number(e?.amount_paid ?? 0);
        return [
          t.ageGroup,
          t.name,
          due ? due.toFixed(2) : "",
          paid ? paid.toFixed(2) : "",
          (Math.max(0, due - paid) || 0).toFixed(2),
          e?.method ?? "",
          e?.paid_at ? new Date(e.paid_at).toLocaleString("en-US") : "",
          e?.receipt_url ?? "",
          e?.note ?? "",
        ];
      }),
    ];
    // Quote every cell and double any inner quotes. Team names contain commas
    // and apostrophes, which would otherwise shift columns in Excel.
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${leagueId}-payments.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Email every unpaid team currently in view. */
  async function emailUnpaid() {
    const targets = visibleTeams.filter(
      (t) => !(Number(teamPay[t.id]?.amount_paid ?? 0) > 0),
    );
    if (targets.length === 0) {
      setMsg({ ok: false, text: "Nobody in view is unpaid." });
      return;
    }
    setSending(true);
    setMsg(null);
    try {
      const idToken = await user.getIdToken();
      const call = (action: "preview" | "send") =>
        fetch("/api/admin-payment-reminders", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            leagueId,
            action,
            teamIds: targets.map((t) => t.id),
          }),
        }).then((r) => r.json());

      // Show exactly who would be written to before anything goes out. An
      // email blast is not undoable, so it does not happen on one click.
      const pre = (await call("preview")) as {
        recipients?: { teamName: string }[];
        skipped?: { teamName: string }[];
        error?: string;
      };
      if (pre.error) {
        setMsg({ ok: false, text: pre.error });
        return;
      }
      const n = pre.recipients?.length ?? 0;
      const noEmail = pre.skipped?.length ?? 0;
      if (n === 0) {
        setMsg({
          ok: false,
          text: `No reachable teams. ${noEmail} unpaid team(s) have no email on file.`,
        });
        return;
      }
      const ok = window.confirm(
        `Email ${n} unpaid team${n === 1 ? "" : "s"} a payment reminder?` +
          (noEmail ? `\n\n${noEmail} more have no email on file and will be skipped.` : ""),
      );
      if (!ok) return;

      const res = (await call("send")) as {
        sent?: number;
        failed?: { teamName: string; error: string }[];
        error?: string;
      };
      if (res.error) {
        setMsg({ ok: false, text: res.error });
        return;
      }
      const failed = res.failed ?? [];
      setMsg({
        ok: failed.length === 0,
        text:
          `Sent ${res.sent ?? 0} reminder${res.sent === 1 ? "" : "s"}.` +
          (failed.length
            ? ` ${failed.length} failed: ${failed
                .slice(0, 3)
                .map((f) => `${f.teamName} (${f.error})`)
                .join(", ")}`
            : ""),
      });
      await load();
    } catch (e) {
      setMsg({
        ok: false,
        text: e instanceof Error ? e.message : "Could not send reminders",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Track who&rsquo;s paid the <strong>league</strong> — a team paying as a
        block, or players paying directly (both happen). This is your ledger;
        captains&rsquo; own player tracking isn&rsquo;t shown here.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Total collected" value={money(teamTotal + playerTotal)} tone="emerald" />
        <Card
          label="Teams paid"
          value={`${teamsPaidCount}/${teams.length}`}
        />
        <Card label="Still owed" value={money(outstanding)} />
        <Card label="Player payments" value={money(playerTotal)} />
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

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a team…"
          className="min-w-[180px] flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          aria-label="Find a team"
        />
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          {(["all", "unpaid", "paid"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setShow(k)}
              className={
                "px-3 py-1.5 text-xs font-semibold capitalize " +
                (show === k
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50")
              }
            >
              {k}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500">
          {visibleTeams.length} of {teams.length} teams
        </span>
        <button
          type="button"
          onClick={emailUnpaid}
          disabled={sending}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {sending ? "Sending…" : "Email the unpaid"}
        </button>
        <button
          type="button"
          onClick={exportCsv}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Export CSV
        </button>
      </div>

      <div className="space-y-2">
        {visibleTeams.map((t, i) => {
          // Teams are sorted by age group, so a header appears whenever the
          // age group changes. Doug scans for "10U" rather than a team name.
          const prev = i > 0 ? visibleTeams[i - 1] : null;
          const newAge = !prev || prev.ageGroup !== t.ageGroup;
          const roster = playersByTeam[t.id] ?? [];
          const tEntry = teamPay[t.id] ?? { amount_paid: "", amount_due: "", note: "", method: "", paid_at: "", receipt_url: "", reminder_sent_at: "" };
          const open = expanded === t.id;
          const playerPaidCount = roster.filter(
            (p) => Number(playerPay[p.id]?.amount_paid) > 0,
          ).length;
          return (
            <div key={t.id}>
              {newAge && (
                <h3 className="mb-1 mt-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 pb-1 first:mt-0">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {t.ageGroup || "No age group"}
                  </span>
                  {(() => {
                    const a = ageTotals.get(t.ageGroup || "No age group");
                    if (!a) return null;
                    return (
                      <span className="text-xs font-normal text-slate-500">
                        {a.paid} of {a.teams} paid
                        {a.owed > 0 ? (
                          <span className="ml-2 font-semibold text-red-600">
                            {money(a.owed)} owed
                          </span>
                        ) : null}
                      </span>
                    );
                  })()}
                </h3>
              )}
              <div className="overflow-hidden rounded-md border border-slate-200">
              {/* Team-level row */}
              <div className="flex flex-wrap items-center gap-2 bg-slate-50 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : t.id)}
                  className="w-full sm:flex-1 sm:w-auto sm:min-w-[150px] text-left text-sm font-semibold text-slate-900"
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
                    className="w-20 sm:w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
                {/* How they paid is a fixed set, so it is a dropdown. It used
                    to be a free-text note, which meant Doug typing "venmo",
                    "Venmo 5/2" and "VENMO" into 196 rows that could never be
                    counted or filtered. Card rows are set automatically by the
                    checkout. */}
                <select
                  value={tEntry.method}
                  onChange={(e) =>
                    setTeamPay((m) => ({
                      ...m,
                      [t.id]: { ...tEntry, method: e.target.value },
                    }))
                  }
                  className="w-28 sm:w-32 rounded border border-slate-300 px-2 py-1 text-sm"
                  aria-label={`How ${t.name} paid`}
                >
                  <option value="">How paid…</option>
                  <option value="card">Card</option>
                  <option value="venmo">Venmo</option>
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
                <PaidBadge entry={tEntry} />
                {tEntry.receipt_url && (
                  <a
                    href={tEntry.receipt_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-sky-700 underline"
                    title="Square receipt for this payment"
                  >
                    Receipt
                  </a>
                )}
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
                      const e = playerPay[p.id] ?? { amount_paid: "", amount_due: "", note: "", method: "", paid_at: "", receipt_url: "", reminder_sent_at: "" };
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
            </div>
          );
        })}
        {visibleTeams.length === 0 && (
          <p className="rounded-md border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
            No teams match that.
          </p>
        )}
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

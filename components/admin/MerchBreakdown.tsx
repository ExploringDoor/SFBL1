"use client";

// The shirt pile, sorted three ways.
//
// Melinda, via Mike on 2026-09-07: "a breakdown of shirts and we can sort them
// by team sort them by size sort them by Age once we close the store."
//
// A HANDOVER SHEET, not a sales report. On Saturday morning somebody stands at
// a field with a box and needs three things: how many of each size to bring,
// whose stack is whose, and who has not paid. Revenue is the least useful
// number here, so it is one line rather than the headline.
//
// Built from the rows already on screen, so the totals and the list below can
// never disagree, including when a filter is applied.

import { useState } from "react";
import type { User } from "firebase/auth";
import {
  inWindow,
  splitByItem,
  methodLabel,
  summarise,
  type MerchOrderRow,
  type Tally,
} from "@/lib/merch-report";

/**
 * Start of the current selling week, as an ISO instant.
 *
 * The store shuts Thursday 4pm and reopens Saturday 6am, so a "week" runs from
 * that Saturday. Mike takes the list to the field on Saturday morning and only
 * wants what has come in since the last one, not the whole season.
 */
function lastSaturday6am(): string {
  const now = new Date();
  const d = new Date(now);
  d.setHours(6, 0, 0, 0);
  // Walk back to Saturday. If it IS Saturday but before 6am, the week that
  // matters is still the previous one.
  const back = (d.getDay() - 6 + 7) % 7;
  d.setDate(d.getDate() - back);
  if (d > now) d.setDate(d.getDate() - 7);
  return d.toISOString();
}

function Group({ title, rows, note }: { title: string; rows: Tally[]; note?: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="min-w-[190px] flex-1">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
        {title}
      </p>
      <ul className="space-y-0.5 text-sm">
        {rows.map((t) => (
          <li key={t.key} className="flex items-baseline justify-between gap-3">
            <span className="text-slate-700">{t.key}</span>
            <span className="whitespace-nowrap font-mono font-semibold text-slate-900">
              {t.shirts}
              {/* Unpaid is the number that decides whether a shirt is handed
                  over, so it travels with every grouping rather than living
                  only in the totals. */}
              {t.unpaid > 0 && (
                <span className="ml-1.5 font-sans text-[11px] font-bold text-amber-700">
                  {t.unpaid} unpaid
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {note && <p className="mt-1 text-[11px] text-slate-500">{note}</p>}
    </div>
  );
}

export function MerchBreakdown({
  rows: allRows,
  leagueId,
  user,
  onChanged,
}: {
  rows: MerchOrderRow[];
  leagueId: string;
  user: User;
  onChanged: () => void | Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  /**
   * Record a Venmo or Zelle order as paid.
   *
   * Mike, 2026-09-10: "is there a way to know if Venmo or Zelle went through
   * on the site without looking at Venmo or Zelle?" No, and there never will
   * be: Venmo has no API for a personal account and Zelle has none at all.
   * Somebody who saw the money has to say so, and until now they had no way
   * to. This is that way.
   */
  async function mark(r: MerchOrderRow, action: "paid" | "clear") {
    setBusyId(r.id);
    setErr(null);
    try {
      const res = await fetch("/api/admin-merch-payment", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await user.getIdToken()}`,
        },
        body: JSON.stringify({
          leagueId,
          id: r.id,
          action,
          method: String(r.pay_method ?? "venmo").toLowerCase(),
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save that.");
    } finally {
      setBusyId(null);
    }
  }

  // Defaults to the whole season, because that is the number the office checks
  // stock against. The weekly view is one click away for the field run.
  const [thisWeek, setThisWeek] = useState(false);
  const rows = thisWeek ? inWindow(allRows, lastSaturday6am()) : allRows;
  const s = summarise(rows);
  // Grouped by design. One entry while a single shirt is selling, which is
  // what keeps the single-shirt view identical to what it was.
  const perItem = splitByItem(rows);
  // Unpaid AND not a card order. An unpaid card order is an abandoned checkout,
  // not money somebody owes in Venmo, and ticking it here would record a
  // payment that never happened.
  const toCollect = rows.filter(
    (r) =>
      r.payment_status !== "paid" &&
      r.payment?.status !== "paid" &&
      String(r.pay_method ?? "").toLowerCase() !== "card",
  );
  if (summarise(allRows).orders === 0) return null;

  const csv = () => {
    // "Shirt" first, and sorted on it, so a spreadsheet with two designs in it
    // does not have to be re-sorted before anybody can pack from it.
    const head = ["Shirt", "Division", "Team", "Player", "Size", "Qty", "Paid", "Method", "Ordered by", "Email", "Phone"];
    const body = [...rows]
      .sort(
        (a, b) =>
          String(a.item_name ?? "").localeCompare(String(b.item_name ?? "")) ||
          String(a.division ?? "").localeCompare(String(b.division ?? "")) ||
          String(a.team_name ?? "").localeCompare(String(b.team_name ?? "")) ||
          String(a.player_name ?? "").localeCompare(String(b.player_name ?? "")),
      )
      .map((r) => [
        r.item_name ?? "Shirt",
        r.division ?? "",
        r.team_name ?? "",
        r.player_name ?? "",
        r.size ?? "",
        String(r.quantity ?? ""),
        r.payment_status === "paid" || r.payment?.status === "paid" ? "yes" : "no",
        methodLabel(r),
        r.name ?? "",
        r.email ?? "",
        r.phone ?? "",
      ]);
    const text = [head, ...body]
      .map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `shirt-orders${thisWeek ? "-this-week" : ""}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <span className="text-lg font-bold text-slate-900">
          {s.shirts} shirt{s.shirts === 1 ? "" : "s"}
        </span>
        <span className="text-sm text-slate-600">
          {s.orders} order{s.orders === 1 ? "" : "s"}
        </span>
        {s.unpaidShirts > 0 && (
          <span className="text-sm font-semibold text-amber-700">
            {s.unpaidShirts} not paid for yet, ${s.owed} outstanding
          </span>
        )}
        <span className="text-sm text-slate-600">${s.collected} collected</span>
        <button
          type="button"
          onClick={() => setThisWeek((v) => !v)}
          className={
            "ml-auto rounded-md border px-3 py-1.5 text-xs font-semibold " +
            (thisWeek
              ? "border-slate-800 bg-slate-800 text-white"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")
          }
        >
          {thisWeek ? "This week only" : "Whole season"}
        </button>
        <button
          type="button"
          onClick={csv}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Download the list
        </button>
      </div>
      {/* ONE BLOCK PER SHIRT once there is more than one design.
          Melinda, 2026-09-11, asked whether each shirt would get its own
          category. It has to: "By size, 19 smalls" is what somebody packs the
          boxes from, and across two designs that is nineteen smalls of nothing
          in particular. With a single design on sale this renders exactly what
          it always did, with no extra heading to read past. */}
      {perItem.length > 1 ? (
        <div className="space-y-4">
          {perItem.map((g) => (
            <div key={g.item} className="rounded-md border border-slate-200 bg-white p-3">
              <p className="mb-2 text-sm font-bold text-slate-900">
                {g.item}
                <span className="ml-2 font-normal text-slate-500">
                  {g.summary.shirts} shirt{g.summary.shirts === 1 ? "" : "s"},{" "}
                  {g.summary.orders} order{g.summary.orders === 1 ? "" : "s"}
                  {g.summary.owed > 0 ? `, $${g.summary.owed} owed` : ""}
                </span>
              </p>
              <div className="flex flex-wrap gap-6">
                <Group title="By size" rows={g.summary.bySize} note="How many of each to bring." />
                <Group title="By payment" rows={g.summary.byMethod} />
                <Group title="By team" rows={g.summary.byTeam} />
                <Group title="By age" rows={g.summary.byAge} />
                <Group title="By division" rows={g.summary.byDivision} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-6">
          <Group title="By size" rows={s.bySize} note="How many of each to bring." />
          <Group
            title="By payment"
            rows={s.byMethod}
            note="Card is already settled. Venmo and Zelle owe until the office marks them paid."
          />
          <Group title="By team" rows={s.byTeam} />
          <Group title="By age" rows={s.byAge} />
          <Group title="By division" rows={s.byDivision} />
        </div>
      )}

      {/* MONEY TO COLLECT. The only orders that need a human decision: a card
          order is settled by Square, and these are promises until somebody who
          saw the transfer says so. */}
      {toCollect.length > 0 && (
        <div className="mt-3 border-t border-slate-200 pt-3">
          <p className="mb-2 text-sm font-semibold text-slate-900">
            Money to collect: {toCollect.length} order
            {toCollect.length === 1 ? "" : "s"}, $
            {toCollect.reduce((n, r) => n + (Number(r.amount_due ?? 0) || 0), 0)}
          </p>
          <p className="mb-2 text-xs text-slate-600">
            Check Venmo or Zelle for the payment, then tick it here. The site
            cannot see those transfers on its own.
          </p>
          <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
            {toCollect.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="font-semibold text-slate-900">
                  {r.player_name || r.name || "No name"}
                </span>
                <span className="text-slate-600">{r.team_name || "No team"}</span>
                <span className="text-slate-600">size {r.size}</span>
                <span className="font-semibold text-amber-700">
                  ${Number(r.amount_due ?? 0) || 0} by {methodLabel(r)}
                </span>
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void mark(r, "paid")}
                  className="ml-auto rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                >
                  {busyId === r.id ? "Saving…" : "Mark paid"}
                </button>
              </li>
            ))}
          </ul>
          {err && <p className="mt-2 text-xs font-semibold text-red-700">{err}</p>}
        </div>
      )}
    </div>
  );
}

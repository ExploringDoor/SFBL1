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

import { summarise, type MerchOrderRow, type Tally } from "@/lib/merch-report";

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

export function MerchBreakdown({ rows }: { rows: MerchOrderRow[] }) {
  const s = summarise(rows);
  if (s.orders === 0) return null;

  const csv = () => {
    const head = ["Division", "Team", "Player", "Size", "Qty", "Paid", "Method", "Ordered by", "Email", "Phone"];
    const body = [...rows]
      .sort(
        (a, b) =>
          String(a.division ?? "").localeCompare(String(b.division ?? "")) ||
          String(a.team_name ?? "").localeCompare(String(b.team_name ?? "")) ||
          String(a.player_name ?? "").localeCompare(String(b.player_name ?? "")),
      )
      .map((r) => [
        r.division ?? "",
        r.team_name ?? "",
        r.player_name ?? "",
        r.size ?? "",
        String(r.quantity ?? ""),
        r.payment_status === "paid" ? "yes" : "no",
        r.pay_method ?? "",
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
    a.download = `shirt-orders-${new Date().toISOString().slice(0, 10)}.csv`;
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
          onClick={csv}
          className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Download the list
        </button>
      </div>
      <div className="flex flex-wrap gap-6">
        <Group title="By size" rows={s.bySize} note="How many of each to bring." />
        <Group title="By team" rows={s.byTeam} />
        <Group title="By division" rows={s.byDivision} />
      </div>
    </div>
  );
}

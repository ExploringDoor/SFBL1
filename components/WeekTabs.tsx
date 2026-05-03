// Horizontal scrollable week selector. Each tab shows "WK N" on top and
// the date range below; the active week is underlined. Server component —
// the parent page handles the query-param state via URL.

import Link from "next/link";

export interface WeekTab {
  number: number;
  startIso: string;     // YYYY-MM-DD of the Monday of the week
  rangeLabel: string;   // e.g. "Apr 20–22" or "May 3"
  active: boolean;
}

export function WeekTabs({
  weeks,
  basePath,
}: {
  weeks: WeekTab[];
  basePath: string; // e.g. "/schedule" — used as Link href base
}) {
  if (weeks.length === 0) return null;
  return (
    <div className="mb-6 flex items-center gap-2 border-b border-slate-200">
      <button
        type="button"
        aria-label="Previous weeks"
        className="px-1 text-slate-400 hover:text-slate-700"
      >
        ‹
      </button>
      <div className="flex flex-1 gap-6 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {weeks.map((w) => (
          <Link
            key={w.startIso}
            href={`${basePath}?week=${w.startIso}`}
            className={
              "flex flex-col items-center pb-1 text-center " +
              (w.active
                ? "border-b-2 border-slate-900 text-slate-900"
                : "border-b-2 border-transparent text-slate-500 hover:text-slate-700")
            }
          >
            <span className="text-xs font-bold uppercase tracking-wider">
              WK {w.number}
            </span>
            <span className="whitespace-nowrap text-xs">
              {w.rangeLabel}
            </span>
          </Link>
        ))}
      </div>
      <button
        type="button"
        aria-label="Next weeks"
        className="px-1 text-slate-400 hover:text-slate-700"
      >
        ›
      </button>
    </div>
  );
}

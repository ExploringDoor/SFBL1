// Local scoreboard nav components — Scores|Schedule tabs + week-by-week
// row. Uses the .tab-row / .dn-row / .dn-slot CSS from globals.css to
// match DVSL exactly. Pure server components (no interactivity beyond
// link navigation).

import Link from "next/link";

export function ScoresScheduleTabs({ active }: { active: "scores" | "schedule" }) {
  return (
    <div className="tab-row">
      <Link
        href="/scores"
        className={"tab-btn " + (active === "scores" ? "active" : "")}
      >
        Scores
      </Link>
      <Link
        href="/schedule"
        className={"tab-btn " + (active === "schedule" ? "active" : "")}
      >
        Schedule
      </Link>
    </div>
  );
}

export interface WeekItem {
  startIso: string;
  number: number;
  rangeLabel: string;
  active: boolean;
}

export function WeekRow({
  weeks,
  basePath,
}: {
  weeks: WeekItem[];
  basePath: string;
}) {
  if (weeks.length === 0) return null;
  return (
    <div className="dn-row">
      <button className="dn-arrow" type="button" aria-label="Previous">
        ‹
      </button>
      <div className="dn-slots">
        {weeks.map((w) => (
          <Link
            key={w.startIso}
            href={`${basePath}?week=${w.startIso}`}
            className={"dn-slot " + (w.active ? "active" : "")}
          >
            <span className="wk-label">WK {w.number}</span>
            <span className="wk-date">{w.rangeLabel}</span>
          </Link>
        ))}
      </div>
      <button className="dn-arrow" type="button" aria-label="Next">
        ›
      </button>
    </div>
  );
}

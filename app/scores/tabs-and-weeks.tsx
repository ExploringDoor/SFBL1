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
  // Wire the prev/next arrows to the weeks on either side of the active
  // one (they used to be dead <button>s). Disabled at the ends.
  const activeIdx = weeks.findIndex((w) => w.active);
  const prev = activeIdx > 0 ? weeks[activeIdx - 1] : null;
  const next =
    activeIdx >= 0 && activeIdx < weeks.length - 1 ? weeks[activeIdx + 1] : null;
  return (
    <div className="dn-row">
      {prev ? (
        <Link
          href={`${basePath}?week=${prev.startIso}`}
          className="dn-arrow"
          aria-label={`Previous week (Week ${prev.number})`}
        >
          ‹
        </Link>
      ) : (
        <span className="dn-arrow" aria-disabled="true" aria-label="Previous week">
          ‹
        </span>
      )}
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
      {next ? (
        <Link
          href={`${basePath}?week=${next.startIso}`}
          className="dn-arrow"
          aria-label={`Next week (Week ${next.number})`}
        >
          ›
        </Link>
      ) : (
        <span className="dn-arrow" aria-disabled="true" aria-label="Next week">
          ›
        </span>
      )}
    </div>
  );
}

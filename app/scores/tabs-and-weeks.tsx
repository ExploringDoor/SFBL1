// Local scoreboard nav components — Scores|Schedule tabs + week-by-week
// row. Uses the .tab-row / .dn-row / .dn-slot CSS from globals.css to
// match DVSL exactly. Client component: the week row auto-scrolls the
// active pill into view and the arrows navigate to the adjacent week.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

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
  const router = useRouter();
  const slotsRef = useRef<HTMLDivElement>(null);

  const activeIdx = weeks.findIndex((w) => w.active);
  const activeStart = activeIdx >= 0 ? weeks[activeIdx]?.startIso ?? null : null;
  // Late-season the active pill (e.g. WK 18 of 18) sits far right in the
  // scroller; without this, phones land showing the first weeks of the
  // season. Scroll ONLY the pill strip via scrollLeft — scrollIntoView
  // also scrolls every scrollable ancestor including the window, which
  // yanked the whole page down/right past the header on load.
  useEffect(() => {
    const container = slotsRef.current;
    const active = container?.querySelector<HTMLElement>(".dn-slot.active");
    if (!container || !active) return;
    container.scrollLeft =
      active.offsetLeft - (container.clientWidth - active.offsetWidth) / 2;
  }, [activeStart]);

  // Arrow nav: jump to the adjacent week, keeping any other filters
  // (div, team) already in the URL. Read window.location at click time
  // so the server-rendered markup stays param-free and hydration-stable.
  function goToWeek(idx: number) {
    const target = weeks[idx];
    if (!target) return;
    const params = new URLSearchParams(window.location.search);
    params.set("week", target.startIso);
    router.push(`${basePath}?${params.toString()}`);
  }

  const prevDisabled = activeIdx <= 0;
  const nextDisabled = activeIdx === -1 || activeIdx === weeks.length - 1;
  const disabledStyle = { opacity: 0.35, cursor: "default" } as const;

  if (weeks.length === 0) return null;
  return (
    <div className="dn-row">
      <button
        className="dn-arrow"
        type="button"
        aria-label="Previous week"
        disabled={prevDisabled}
        aria-disabled={prevDisabled}
        style={prevDisabled ? disabledStyle : undefined}
        onClick={() => goToWeek(activeIdx - 1)}
      >
        ‹
      </button>
      <div className="dn-slots" ref={slotsRef}>
        {weeks.map((w, idx) => (
          // Keep the <a href> for SSR-deterministic markup + no-JS
          // fallback, but intercept the click so it navigates the same
          // param-preserving way the arrows do (goToWeek clones the
          // current search at click time, keeping div/team).
          <Link
            key={w.startIso}
            href={`${basePath}?week=${w.startIso}`}
            className={"dn-slot " + (w.active ? "active" : "")}
            onClick={(e) => {
              e.preventDefault();
              goToWeek(idx);
            }}
          >
            <span className="wk-label">WK {w.number}</span>
            <span className="wk-date">{w.rangeLabel}</span>
          </Link>
        ))}
      </div>
      <button
        className="dn-arrow"
        type="button"
        aria-label="Next week"
        disabled={nextDisabled}
        aria-disabled={nextDisabled}
        style={nextDisabled ? disabledStyle : undefined}
        onClick={() => goToWeek(activeIdx + 1)}
      >
        ›
      </button>
    </div>
  );
}

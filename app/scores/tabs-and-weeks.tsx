// Local scoreboard nav components — Scores|Schedule tabs + week-by-week
// row. Uses the .tab-row / .dn-row / .dn-slot CSS from globals.css to
// match DVSL exactly. Pure server components (no interactivity beyond
// link navigation).

import Link from "next/link";

// Keeping the chosen age group in the URL when switching Scores<->Schedule so
// the filter doesn't reset out from under the user. Week resets (the new tab
// re-picks its own active week).
export function ScoresScheduleTabs({
  active,
  age,
}: {
  active: "scores" | "schedule";
  age?: string;
}) {
  const q = age ? `?age=${encodeURIComponent(age)}` : "";
  return (
    <div className="tab-row">
      <Link
        href={`/scores${q}`}
        className={"tab-btn " + (active === "scores" ? "active" : "")}
      >
        Scores
      </Link>
      <Link
        href={`/schedule${q}`}
        className={"tab-btn " + (active === "schedule" ? "active" : "")}
      >
        Schedule
      </Link>
    </div>
  );
}

export interface AgeOption {
  value: string; // "" means "All ages"
  label: string;
  active: boolean;
}

// Age-group pill row for age-grouped leagues (COYBL). Hidden when a league has
// fewer than two age groups (e.g. SFBL), so flat leagues are unaffected.
// Picking an age resets the week — the page re-picks the active week for that
// age's games.
export function AgeFilterRow({
  ages,
  basePath,
}: {
  ages: AgeOption[];
  basePath: string;
}) {
  if (ages.length <= 1) return null;
  return (
    <div
      style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "2px 0 14px" }}
    >
      {ages.map((a) => (
        <Link
          key={a.value || "all"}
          href={a.value ? `${basePath}?age=${encodeURIComponent(a.value)}` : basePath}
          style={{
            display: "inline-block",
            padding: "5px 13px",
            borderRadius: 999,
            border: "1px solid var(--border)",
            background: a.active ? "var(--brand-primary)" : "var(--card)",
            color: a.active ? "#fff" : "var(--brand-primary)",
            fontWeight: 800,
            fontSize: 12.5,
            letterSpacing: "0.04em",
            textDecoration: "none",
          }}
        >
          {a.label}
        </Link>
      ))}
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
  age,
}: {
  weeks: WeekItem[];
  basePath: string;
  age?: string;
}) {
  if (weeks.length === 0) return null;
  const ageQ = age ? `&age=${encodeURIComponent(age)}` : "";
  return (
    <div className="dn-row">
      <button className="dn-arrow" type="button" aria-label="Previous">
        ‹
      </button>
      <div className="dn-slots">
        {weeks.map((w) => (
          <Link
            key={w.startIso}
            href={`${basePath}?week=${w.startIso}${ageQ}`}
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

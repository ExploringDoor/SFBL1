"use client";

// Homepage age-switcher standings (COYBL). Shows one age group's
// standings inline and swaps between ages IN PLACE — no navigation. The
// youngest age (7U) is selected by default. "Full standings →" is the
// only link that leaves the homepage.

import { useState } from "react";
import Link from "next/link";
import {
  StandingsTable,
  type DivisionGroup,
  type TeamMeta,
} from "@/components/ui/StandingsTable";

export interface AgeStandingsSection {
  ageGroup: string;
  divisionGroups: DivisionGroup[];
}

export function HomeAgeStandings({
  ages,
  teamMeta,
}: {
  ages: AgeStandingsSection[];
  teamMeta: Record<string, TeamMeta>;
}) {
  // Open on the BIGGEST age group, not the youngest.
  //
  // Ages are sorted youngest first, which is right for the tab strip and
  // wrong as a landing view: Island has one 8U team and seventeen 14U, so
  // the standings opened on a table with a single row while the real
  // division sat a tab away. Ties keep the youngest, so a league with even
  // groups behaves exactly as before.
  const [active, setActive] = useState(() => {
    let best = ages[0];
    for (const a of ages) {
      const n = a.divisionGroups.reduce((t, g) => t + g.rows.length, 0);
      const bestN = best
        ? best.divisionGroups.reduce((t, g) => t + g.rows.length, 0)
        : -1;
      if (n > bestN) best = a;
    }
    return best?.ageGroup ?? "";
  });
  const sel = ages.find((a) => a.ageGroup === active) ?? ages[0];
  if (!sel) return null;

  return (
    <div>
      <div
        role="tablist"
        aria-label="Age group"
        style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}
      >
        {ages.map((a) => {
          const on = a.ageGroup === sel.ageGroup;
          return (
            <button
              key={a.ageGroup}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActive(a.ageGroup)}
              style={{
                minHeight: 38,
                padding: "6px 13px",
                borderRadius: 999,
                border:
                  "1px solid " +
                  (on ? "var(--brand-primary)" : "rgba(0,0,0,0.14)"),
                background: on ? "var(--brand-primary)" : "#fff",
                color: on ? "#fff" : "var(--brand-primary)",
                fontWeight: 800,
                fontSize: 13,
                letterSpacing: "0.02em",
                cursor: "pointer",
              }}
            >
              {a.ageGroup}
            </button>
          );
        })}
      </div>

      <StandingsTable
        groups={sel.divisionGroups}
        teamMeta={teamMeta}
        variant="compact"
        showExtras={false}
        showRecentForm={false}
      />

      <Link
        href={`/standings#age-${sel.ageGroup}`}
        style={{
          display: "inline-block",
          marginTop: 14,
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: "0.04em",
          color: "var(--brand-primary)",
          textDecoration: "none",
        }}
      >
        Full standings →
      </Link>
    </div>
  );
}

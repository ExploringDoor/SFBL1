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
  const [active, setActive] = useState(ages[0]?.ageGroup ?? "");
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

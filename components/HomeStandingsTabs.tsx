"use client";

// Home-sidebar standings for age-grouped leagues: a compact age-group tab
// row; pick an age and that age's divisions show (compact StandingsTable).
// Mirrors the tabbed ticker so the home page reads consistently.

import { useState } from "react";
import { StandingsTable, type DivisionGroup, type TeamMeta } from "./StandingsTable";

export interface HomeAgeSection {
  ageGroup: string;
  groups: DivisionGroup[];
}

export function HomeStandingsTabs({
  sections,
  teamMeta,
  pointsScheme,
}: {
  sections: HomeAgeSection[];
  teamMeta: Record<string, TeamMeta>;
  pointsScheme: { win: number; tie: number; loss: number } | null;
}) {
  const [sel, setSel] = useState(sections[0]!.ageGroup);
  const active = sections.find((s) => s.ageGroup === sel) ?? sections[0]!;

  return (
    <div>
      <div
        role="tablist"
        aria-label="Standings by age group"
        style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}
      >
        {sections.map((s) => {
          const isActive = s.ageGroup === sel;
          return (
            <button
              key={s.ageGroup}
              role="tab"
              aria-selected={isActive}
              onClick={() => setSel(s.ageGroup)}
              style={{
                appearance: "none",
                cursor: "pointer",
                padding: "4px 9px",
                borderRadius: 6,
                fontSize: 11.5,
                fontWeight: 800,
                letterSpacing: "0.03em",
                border: isActive ? "1px solid var(--brand-primary)" : "1px solid var(--border)",
                background: isActive ? "var(--brand-primary)" : "var(--card)",
                color: isActive ? "#fff" : "var(--brand-primary)",
              }}
            >
              {s.ageGroup}
            </button>
          );
        })}
      </div>
      <StandingsTable
        groups={active.groups}
        teamMeta={teamMeta}
        pointsScheme={pointsScheme}
        variant="compact"
      />
    </div>
  );
}

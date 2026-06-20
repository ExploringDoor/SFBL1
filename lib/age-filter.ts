// Shared age-group filter logic for the Scores and Schedule pages. Age-grouped
// leagues (e.g. COYBL: 10U/12U) get a pill row to scope games to one age;
// flat leagues (e.g. SFBL, no team.ageGroup) get no options and are unaffected.

import { ageOrder } from "@/lib/standings";

export interface TeamAgeMeta {
  ageGroup?: string;
}

export interface AgeFilterOption {
  value: string; // "" means "All ages"
  label: string;
  active: boolean;
}

export interface AgeFilterResult {
  /** Distinct age groups present, sorted youngest-first. */
  groups: string[];
  /** The validated current selection, or null for "all". */
  selectedAge: string | null;
  /** Pills for AgeFilterRow — empty when there are fewer than two groups. */
  ageOptions: AgeFilterOption[];
  /** A game's age group: its home team's, falling back to the away team's. */
  ageOf: (homeId: string, awayId: string) => string | undefined;
}

export function buildAgeFilter(
  teams: Record<string, TeamAgeMeta>,
  requested: string | undefined,
): AgeFilterResult {
  const teamAge = new Map<string, string>();
  for (const [id, t] of Object.entries(teams)) {
    if (t.ageGroup) teamAge.set(id, t.ageGroup);
  }

  const groups = [...new Set(teamAge.values())].sort(
    (a, b) => ageOrder(a) - ageOrder(b),
  );
  const selectedAge = requested && groups.includes(requested) ? requested : null;

  const ageOptions: AgeFilterOption[] =
    groups.length >= 2
      ? [
          { value: "", label: "All ages", active: !selectedAge },
          ...groups.map((g) => ({ value: g, label: g, active: g === selectedAge })),
        ]
      : [];

  const ageOf = (homeId: string, awayId: string) =>
    teamAge.get(homeId) ?? teamAge.get(awayId);

  return { groups, selectedAge, ageOptions, ageOf };
}

// Which options a dependent <select> should offer right now.
//
// Lives outside components/forms/LeagueForm.tsx so it can be unit tested. That
// file is a Client Component whose import graph reaches the Square card form,
// which touches browser globals at module scope — importing it into a Node test
// run is not worth the trouble for one pure function.
//
// The rule this exists to enforce, at Island Fastpitch: a team's age decides
// which leagues it can enter. 8U plays the "8U Weekend League" and nothing
// else. Two independent dropdowns let a coach register for a league that does
// not exist, and because lib/square.ts prices 8U at $500 (the 8U WEEKEND fee)
// that invalid pairing also underbilled the team by $295.

export interface SelectOption {
  value: string;
  label: string;
}

/** The shape this needs from a form field. Structural on purpose, so there is
 *  no import cycle back into LeagueForm for its FormField type. */
export interface DependentSelect {
  name: string;
  options?: SelectOption[];
  dependsOn?: string;
  optionsBy?: Record<string, SelectOption[]>;
}

/**
 * Options for `field` given the form's current `data`.
 *
 * Falls back to `field.options` whenever the dependency cannot be resolved —
 * no `dependsOn`, no `optionsBy`, parent unanswered, or a parent value with no
 * entry in `optionsBy`. A stale lookup table then degrades to "offer
 * everything" rather than "offer nothing", so an age group added next season
 * cannot leave a coach staring at an empty dropdown.
 */
export function optionsFor(
  field: DependentSelect,
  data: Record<string, unknown>,
): SelectOption[] {
  if (!field.dependsOn || !field.optionsBy) return field.options ?? [];
  const parent = data[field.dependsOn];
  if (typeof parent !== "string" || !parent) return field.options ?? [];
  return field.optionsBy[parent] ?? field.options ?? [];
}

/**
 * The value `field` should hold after its parent changed.
 *
 * Returns "" when the current value is no longer on offer. Without this, a
 * coach who picks 10U then Weeknight, then corrects the age to 8U, keeps
 * `division: "weeknight"` — the invalid pairing survives, now invisible
 * because the dropdown has stopped displaying it.
 */
export function prunedValue(
  field: DependentSelect,
  data: Record<string, unknown>,
): string {
  const current = data[field.name];
  if (typeof current !== "string" || !current) return "";
  return optionsFor(field, data).some((o) => o.value === current)
    ? current
    : "";
}

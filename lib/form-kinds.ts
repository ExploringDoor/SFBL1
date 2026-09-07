// Every kind of form submission, in one place.
//
// This list was copied into four files: the admin viewer's tab strip, and the
// read, status and delete routes. All four had to agree, and when they did not
// the symptom was always the same red box, "unknown kind: <x>", where the list
// should be. It has happened at least three times: clinic_registration on the
// status route, the same on delete, and merch_order on 2026-09-07, which left
// Mike looking at an error while thirty four real shirt orders sat in the
// database he could not see.
//
// So the list lives here and the copies are gone. Adding a form now means
// adding one line, and the tab, the list, the status buttons and the delete
// button all learn about it together.

export const FORM_KINDS = [
  "team_registration",
  "player_registration",
  "team_waiver",
  "clinic_registration",
  "umpire_evaluation",
  "coach_evaluation",
  "site_feedback",
  "player_waiver",
  "alerts_signup",
  "umpire_registration",
  "tournament_registration",
  "baseball_order",
  // Island's league store.
  "merch_order",
] as const;

export type FormKind = (typeof FORM_KINDS)[number];

/** The set the API routes gate on. A kind becomes part of a Firestore path,
 *  so it is allow-listed rather than interpolated. */
export const FORM_KIND_SET: ReadonlySet<string> = new Set(FORM_KINDS);

export function isFormKind(v: unknown): v is FormKind {
  return typeof v === "string" && FORM_KIND_SET.has(v);
}

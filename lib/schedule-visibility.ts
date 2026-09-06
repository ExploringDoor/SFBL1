// Is the league's schedule hidden while somebody rebuilds it?
//
// Mike, 2026-09-06: "once I post it live can we have a button to make it
// visible and invisible if I am working and moving things around?"
//
// ONE FLAG, ONE DOCUMENT. The alternative was a `published` field on each game,
// and that would have to be honoured by all fifteen places that read games. A
// missed one shows fixtures that are being moved, or texts a coach a game that
// is about to change. One document read by the pages that show FIXTURES is a
// smaller promise and a keepable one.
//
// IT LIVES IN site_config, NOT IN THE TENANT CONFIG FLAGS. The config is
// cached at the edge; this has to take effect the moment the button is pressed,
// which is the same reason the homepage banner lives there.
//
// WHAT IT DOES NOT HIDE. Results, scores and standings: a game that has been
// played is not part of the reshuffle, and blanking a coach's record because
// next week is in flux would be its own bug. And the calendar feed keeps
// serving, because a feed that empties itself DELETES the games out of
// everybody's phone, which is worse than an event that moves.

import { getAdminDb } from "@/lib/firebase-admin";

export interface ScheduleVisibility {
  hidden: boolean;
  /** Optional line shown in place of the fixtures. */
  note: string;
}

const VISIBLE: ScheduleVisibility = { hidden: false, note: "" };

/**
 * Read the stored document into a decision.
 *
 * FAILS OPEN, deliberately and in every direction. A missing document, a
 * half-written one, a string "true" where a boolean belongs: all of them mean
 * VISIBLE. Hiding a league's schedule is a thing an admin does on purpose by
 * pressing a button, never something that happens because a field went missing.
 * Only an explicit boolean true takes the schedule down.
 *
 * Pure, so the rule is testable without Firestore.
 */
export function readVisibility(data: unknown): ScheduleVisibility {
  if (!data || typeof data !== "object") return VISIBLE;
  const d = data as { hidden?: unknown; note?: unknown };
  return {
    hidden: d.hidden === true,
    note: typeof d.note === "string" ? d.note : "",
  };
}

export async function loadScheduleVisibility(
  tenantId: string | null | undefined,
): Promise<ScheduleVisibility> {
  if (!tenantId) return VISIBLE;
  try {
    const snap = await getAdminDb()
      .doc(`leagues/${tenantId}/site_config/schedule`)
      .get();
    if (!snap.exists) return VISIBLE;
    return readVisibility(snap.data());
  } catch {
    // A read that fails must not black out the schedule.
    return VISIBLE;
  }
}

/** The default line, when the admin did not write one. */
export const DEFAULT_HIDDEN_NOTE =
  "The schedule is being updated and will be back shortly.";

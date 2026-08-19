// The College Clinic, in one place.
//
// Three surfaces need these details and they must not disagree: the
// registration page, the popup that offers it on arrival, and the capacity
// check in /api/league-form. A date typed twice is a date that eventually
// gets corrected once.
//
// Hardcoded rather than config-driven on purpose. This is one league's
// one-off event, taken off Mike's printed flyer. The moment a SECOND tenant
// runs a clinic, this moves into Firestore with an admin screen behind it,
// and not before — a config system for a single event that happens once is
// cost with no benefit.
//
// TO TAKE THE POPUP DOWN after 12 October: nothing to do. The popup checks
// `over` below and stops showing itself. The page stays up so anyone with the
// link still lands somewhere sensible rather than a 404.

export const CLINIC = {
  /** Used to generate the graduation-year dropdown. */
  year: 2027,
  /** ISO, for the "has it happened yet" check. */
  date: "2026-10-12",
  dateLabel: "Sunday, October 12",
  timeLabel: "9:00 AM to 2:00 PM",
  ages: "14U, 16U and 18U",
  fee: 175,
  capacity: 40,
  venue: "St John the Baptist HS",
  address: "1170 Montauk Hwy, West Islip, NY",
  phone: "631-831-4793",
  /** Reads naturally in the success message whichever player it is. */
  playerNoun: "Your player",
  colleges: [
    "Wagner College",
    "LIU",
    "St John's University",
    "Mount Saint Vincent",
    "Dominican College",
    "CCNY, The City College of New York",
    "Westchester Community College",
    "Brooklyn College",
    "Purchase College",
    "Monroe College",
  ],
} as const;

/** Has the clinic already happened? Compared at noon UTC for the reason the
 *  tournaments page documents: a date-only string slips to the previous day
 *  in any negative-offset timezone, and Long Island is one. */
export function clinicIsOver(now: Date = new Date()): boolean {
  return now.getTime() > new Date(`${CLINIC.date}T23:59:59Z`).getTime();
}

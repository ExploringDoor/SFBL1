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
// AFTER THE CLINIC: clinicIsOver() is the ONE switch, and it is now wired to
// everything that can take money, not just the popup.
//
// The old note here said "nothing to do", and that was true only of the popup.
// The page, /api/league-form and /api/square-pay all stayed open, so on 13
// October a parent could still register and be charged $175 plus surcharge for
// an event that happened yesterday, and would have been able to indefinitely.
// Five surfaces now read clinicIsOver(): the popup, the registration page, the
// intake API, the card charge, and the nav entry in app/layout.tsx.
//
// /api/square-quote is deliberately NOT one of them. It is read only, it moves
// no money, and a stale quote nobody can act on is not worth a sixth caller.
//
// The page itself still stays reachable. It swaps the form for a short notice
// so an old link, a printed flyer or a search result lands somewhere sensible
// rather than on a 404.

const DATE = "2026-10-12";

/** "Monday, October 12", DERIVED from the date rather than typed beside it.
 *
 *  It was typed, and it said Sunday. The flyer prints only "OCTOBER 12" with
 *  no weekday, so the wrong day was invented here and shipped to a popup on
 *  the front page. Adam caught it. A weekday sitting next to the date it
 *  describes is a fact waiting to disagree with itself, so now it cannot.
 *
 *  Noon UTC for the reason the tournaments page documents: a date-only string
 *  slips to the previous day in any negative-offset timezone. */
const DATE_LABEL = new Date(`${DATE}T12:00:00Z`).toLocaleDateString("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

export const CLINIC = {
  /** Used to generate the graduation-year dropdown. */
  year: 2027,
  /** ISO, for the "has it happened yet" check. */
  date: DATE,
  dateLabel: DATE_LABEL,
  timeLabel: "9:00 AM to 2:00 PM",
  ages: "14U, 16U and 18U",
  fee: 175,
  capacity: 40,
  venue: "St John the Baptist HS",
  address: "1170 Montauk Hwy, West Islip, NY",
  /** THE FLYER IS DOWN, and the venue above is NOT the reason.
   *
   *  Removed 2026-08-23 on a misread: "remove St John from the clinic info"
   *  meant St John's UNIVERSITY, a college that is no longer attending, not
   *  St John the Baptist HS, which is still the venue. The venue is restored.
   *
   *  The flyer stays down because of the college, not the venue. Mike's
   *  printed flyer carries ten logos under "COLLEGES IN ATTENDANCE" and one of
   *  them is ST JOHN'S UNIVERSITY. Publishing it now would advertise a program
   *  that is not coming, to parents paying $175 partly to be seen by it, and
   *  a picture is the one place that claim cannot be quietly corrected.
   *
   *  To put it back: get a reprint from Mike without the St John's logo, drop
   *  it at public/island/clinic/flyer.jpg, add `flyer` here, and restore the
   *  <img> in components/ui/ClinicPopup.tsx in place of the text block. */
  phone: "631-831-4793",
  /** Reads naturally in the success message whichever player it is. */
  playerNoun: "Your player",
  colleges: [
    "Wagner College",
    "LIU",
    // St John's University was here until 2026-08-23. No longer attending.
    // The count in the popup reads colleges.length, so it corrected itself.
    "Mount Saint Vincent",
    "Dominican College",
    "CCNY, The City College of New York",
    "Westchester Community College",
    "Brooklyn College",
    "Purchase College",
    "Monroe College",
  ],
} as const;

/** When the last player goes home, in local wall-clock time. Machine readable
 *  because timeLabel above is prose and prose cannot be compared. */
const END_TIME = "14:00";

/** The clinic is on Long Island, so "has it happened yet" is a question about
 *  New York, not about UTC.
 *
 *  WHAT THIS USED TO DO. It compared against `${DATE}T23:59:59Z`, and its own
 *  comment claimed that was noon UTC, which it never was. In practice it
 *  flipped at 7:59:59 PM Eastern on 12 October, almost six hours after a
 *  clinic that ends at 2 PM. Close enough to look right for the popup,
 *  arrived at by accident, and wrong by a different amount in November when
 *  the offset is five hours instead of four. A hardcoded offset would carry
 *  the same bug forward to the next clinic date.
 *
 *  WHAT IT DOES NOW. Formats `now` as New York wall-clock time and compares it
 *  to the clinic's own wall-clock end. Zero-padded 24 hour values sort
 *  lexicographically, so a string compare is a time compare. Intl carries the
 *  DST rules, so a January clinic works with no edit here.
 *
 *  hourCycle AND NOT hour12, deliberately. Passing hour12: false as well is
 *  not a safer version of the same thing. The spec lets hour12 win, older
 *  engines resolve it to h24, and h24 prints midnight as "24:00", which is
 *  the exact class of accident this function is being rewritten to remove.
 *  This module is imported by ClinicPopup, a Client Component, so it runs on
 *  whatever browser the parent happens to have.
 *
 *  THE EXACT INSTANT, stated once so every caller inherits it: the clinic is
 *  over at 2:01 PM America/New_York on 12 October 2026, which is
 *  2026-10-12T18:01:00Z. Not 18:00:01Z: the stamp this compares is
 *  minute-granular, so the last open minute is 14:00 and it closes when the
 *  clock reads 14:01. If that minute ever matters, compare seconds too rather
 *  than editing this sentence.
 *  Before that the page takes registrations and the card
 *  path takes money, including on the morning of the clinic, because a family
 *  who pays at 9:30 AM can still walk in and Mike can still seat them. After
 *  it, all four money-facing surfaces close together. */
const NY_STAMP = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function clinicIsOver(now: Date = new Date()): boolean {
  const p = Object.fromEntries(
    NY_STAMP.formatToParts(now).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` > `${DATE} ${END_TIME}`;
}

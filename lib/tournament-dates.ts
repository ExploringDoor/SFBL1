// Has a tournament finished? One answer, used by both places that ask.
//
// The home page's "next three tournaments" strip had this logic inline and the
// /tournaments page had none at all, so the day after an event the front page
// correctly dropped it while the tournaments page went on presenting it exactly
// like the ones you can still pay to enter. By December all thirteen would have
// read as available. Tournaments are the paid side of this business, so that is
// not a cosmetic problem.
//
// TWO RULES, both learned the hard way and worth keeping together:
//
// 1. MEASURE AGAINST THE END DATE, not the start. A tournament running Saturday
//    to Sunday must still be listed on the Sunday morning, which is exactly
//    when somebody checks the site to find out where they are playing.
//
// 2. PARSE AT NOON UTC. A date-only string like "2026-09-13" parses as UTC
//    midnight, which is the previous evening in any negative-offset timezone,
//    and Long Island is one. Noon puts the instant safely inside the day
//    whichever side of the Atlantic is asking.

/** A date-only "YYYY-MM-DD" as an instant safely inside that day. */
export function asTournamentDate(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

/**
 * True once the event is over.
 *
 * `end` falls back to `start` for a single-day event. An entry with NEITHER is
 * never past: something we cannot date is something we must not bury, because
 * the failure mode of guessing wrong is hiding a tournament people can still
 * enter.
 */
export function isTournamentPast(
  ev: { start?: string | null; end?: string | null },
  now: Date = new Date(),
): boolean {
  const last = (ev.end || ev.start || "").trim();
  if (!last) return false;
  const cutoff = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return asTournamentDate(last).getTime() < cutoff;
}

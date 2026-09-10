/** The zone league schedules are written in.
 *
 *  Game dates are stored floating (no offset) and rendered as-is, so this is
 *  only needed where a stored wall-clock has to become a real INSTANT — the
 *  Opening Day countdown, the calendar feed, Google Calendar sync.
 *
 *  Per tenant since ETBL (East Texas, Central time): a league sets
 *  `timezone` on its config doc and leagueTimeZone() reads it. Everything
 *  else on the platform is Eastern (NY / PA / OH / FL), which is what the
 *  default still says, so no existing tenant changes.
 */
export const LEAGUE_TIME_ZONE = "America/New_York";

/** Loose so both LeagueConfig and PublicLeagueConfig (and a raw league doc
 *  read on the server) can be handed in. An unset or non-string value falls
 *  back to the platform default; a bad IANA name is the caller's problem
 *  and surfaces as an Intl RangeError, which is louder than a silent hour. */
export function leagueTimeZone(
  config: { timezone?: unknown } | null | undefined,
): string {
  const tz = config?.timezone;
  return typeof tz === "string" && tz.trim() ? tz.trim() : LEAGUE_TIME_ZONE;
}

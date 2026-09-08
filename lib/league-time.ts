/** The zone league schedules are written in.
 *
 *  Game dates are stored floating (no offset) and rendered as-is, so this is
 *  only needed where a stored wall-clock has to become a real INSTANT — the
 *  Opening Day countdown, for one. Every tenant on the platform today is
 *  Eastern (NY / PA / OH / FL). If a Central or Mountain league is ever
 *  provisioned this becomes a per-tenant config value, and the countdown is
 *  the only caller to update.
 */
export const LEAGUE_TIME_ZONE = "America/New_York";

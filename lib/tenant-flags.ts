import type { PublicLeagueConfig } from "@/lib/tenants";

// Stats are ON unless a tenant explicitly disables them (flags.stats_enabled =
// false). Mirrors the layout/header logic so the nav and the stats pages agree
// — youth leagues like COYBL set this false, so /players 404s on a direct hit.
export function statsEnabled(
  config: Pick<PublicLeagueConfig, "flags"> | null | undefined,
): boolean {
  return config?.flags?.stats_enabled !== false;
}

// Whether the captain portal offers the Box Score editor (full batting order
// plus per batter and per pitcher lines) at all.
//
// A league that keeps no stats has stat_columns: [], and filterCols() in the
// box-score editor treats that as "no columns" rather than falling back to the
// default ten. The editor therefore renders a batting table a coach cannot type
// into, above a pitching table that ignores config entirely and shows ten
// columns for a league whose config says pitching is not tracked. Island
// coaches were sent there by every score button on their dashboard for the
// whole 2026 preseason, because the only gate on any of it named "coybl" by
// hand.
//
// Separate name from statsEnabled(), delegating to it, so a league that wants
// box scores without public stat pages (or the reverse) has somewhere to say
// so. Adding a tenant slug to a set is how this bug happened, do not do it.
export function boxScoreEnabled(
  config: Pick<PublicLeagueConfig, "flags"> | null | undefined,
): boolean {
  return statsEnabled(config);
}

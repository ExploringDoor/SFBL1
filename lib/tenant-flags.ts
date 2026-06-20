import type { PublicLeagueConfig } from "@/lib/tenants";

// Stats are ON unless a tenant explicitly disables them (flags.stats_enabled =
// false). Mirrors the layout/header logic so the nav and the stats pages agree
// — youth leagues like COYBL set this false, so /players 404s on a direct hit.
export function statsEnabled(
  config: Pick<PublicLeagueConfig, "flags"> | null | undefined,
): boolean {
  return config?.flags?.stats_enabled !== false;
}

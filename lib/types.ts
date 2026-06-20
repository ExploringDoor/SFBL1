// Tenant config schema. Mirrors the shape in PLAN.md §2 + §3 + §5 + §7.
// One doc per league at /leagues/{slug}. Read on every request via middleware.

export type Sport = "softball" | "baseball";
export type Ruleset = "hardball" | "slowpitch" | "fastpitch";
export type BillingStatus = "active" | "lapsed" | "trial" | "comp";

export interface LeagueTheme {
  primary: string;
  accent: string;
  secondary?: string;
  logo_url?: string;
}

export interface LeagueBilling {
  status: BillingStatus;
  paid_through: string | null;
  last_payment: string | null;
  notes?: string;
}

export interface LeaguePitching {
  tracked: boolean;
  columns?: string[];
}

export interface LeagueRulesFlags {
  dropped_third_strike: boolean;
  balks: boolean;
  infield_fly?: boolean;
}

export interface LeagueFeatureFlags {
  [key: string]: boolean;
}

// Optional standings configuration. When absent, sort by PCT desc with
// run-differential as tiebreaker (the "default baseball" model).
//
// When `scoring` is "points", sort by points desc with the configured
// tiebreaker. Real-world schemes encountered:
//   • SFBL baseball:  {win:2, tie:1, loss:0}, tiebreaker:'pct'
//   • DVSL softball:  {win:3, tie:2, loss:1}, tiebreaker:'pct'
//   • UEFA-style:     {win:3, tie:1, loss:0}
//
// Always store the full triple even when one multiplier is zero, so the
// rule is inspectable from the doc.
export interface LeagueStandingsConfig {
  scoring?: "pct" | "points";
  points_per?: { win: number; tie: number; loss: number };
  tiebreaker?: "pct" | "rd";
}

export interface LeagueTournamentEvent {
  name: string;
  url?: string; // specific event / registration link
  when?: string; // freeform date(s), e.g. "Jun 14-15, 2027"
  location?: string; // venue / city, e.g. "Berliner Park, Columbus OH"
  cost?: string; // freeform fee, e.g. "$595 / team"
  ages?: string; // eligible age groups, e.g. "8U-14U"
  note?: string; // short blurb (charity, divisions, etc.)
}

export interface LeagueTournaments {
  url?: string; // generic landing page (fallback when no events listed)
  events?: LeagueTournamentEvent[];
}

export interface LeagueConfig {
  // Identity
  slug: string;
  name: string;
  abbrev?: string; // short league abbreviation, e.g. "SFBL", "DVSL"

  // Sport variant
  sport: Sport;
  innings: number;
  ruleset: Ruleset;
  linescore_innings: number;

  // Stats
  stat_columns: string[];
  pitching: LeaguePitching;
  rules_flags: LeagueRulesFlags;

  // Per-tenant theming
  theme: LeagueTheme;

  // Manual billing tracker (Stripe replaces this in v2)
  billing: LeagueBilling;

  // Boolean per-tenant feature flags
  flags?: LeagueFeatureFlags;

  // Standings scoring config (optional — defaults to PCT-based)
  standings?: LeagueStandingsConfig;

  // External tournament platform front-door (e.g. COYBL on Five Tool).
  tournaments?: LeagueTournaments;
}

// Custom-domain mapping doc at /domains/{hostname}.
export interface DomainMapping {
  leagueId: string;
}

// What middleware injects into the request via headers.
export interface ResolvedTenant {
  id: string;
  config: LeagueConfig;
}

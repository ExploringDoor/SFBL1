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

export interface LeagueConfig {
  // Identity
  slug: string;
  name: string;

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

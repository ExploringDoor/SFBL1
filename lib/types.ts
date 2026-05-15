// Tenant config schema. Mirrors the shape in PLAN.md §2 + §3 + §5 + §7.
// One doc per league at /leagues/{slug}. Read on every request via middleware.

export type Sport = "softball" | "baseball";
export type Ruleset = "hardball" | "slowpitch" | "fastpitch";
export type BillingStatus = "active" | "lapsed" | "trial" | "comp";

export interface LeagueTheme {
  primary: string;
  accent: string;
  secondary?: string;
  /** Small / square league logo. Used in the top-left ticker tile,
   *  the OG share-card fallback, and the PWA manifest icon. A
   *  square or near-square aspect works best because the ticker
   *  renders this at ~48px tall. */
  logo_url?: string;
  /** Wide banner image used as the homepage Hero. Falls back to
   *  `logo_url` when unset — but tenants with a separate wide
   *  banner asset (LBDC's hero.jpg) can set this and keep their
   *  ticker icon small. */
  banner_url?: string;
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

  // Boolean per-tenant feature flags.
  //
  // Closes audit M17. Field is declared but currently has zero
  // consumers in the codebase — `grep -rn 'config.flags' app/
  // components/ lib/` returns nothing. Left in place because PLAN
  // §7 calls out feature-flag plumbing for v1, but flag-aware code
  // must look like `config?.flags?.<name>` (optional-chained both
  // ways) since the flags object itself is still optional.
  flags?: LeagueFeatureFlags;

  // Standings scoring config (optional — defaults to PCT-based)
  standings?: LeagueStandingsConfig;

  // Footer sponsor strip — rendered on every public page when set.
  // Logos link to the sponsor's website. Empty/missing array = no
  // strip rendered (e.g. tenants in onboarding before they've sold
  // sponsorships).
  sponsors?: LeagueSponsor[];

  // Field/venue catalog. Populates the schedule editor's "Field"
  // dropdown so admins can't typo a venue. Free-text fallback if
  // empty.
  fields?: string[];

  // Per-tenant nav customization. `hide` is a label list (matched
  // case-insensitively against the Nav component's default link
  // labels) — used by LBDC to drop News / Team Registration / Team
  // Waiver / Store from the More dropdown. Mirrored into
  // PublicLeagueConfig so the layout can pass it to <Nav>.
  nav?: {
    hide?: string[];
  };
}

export interface LeagueSponsor {
  /** Display name shown on hover / for screen readers. */
  name: string;
  /** Logo URL — public path or absolute https URL. PNG with
   *  transparent background works best on the dark footer strip. */
  logo_url: string;
  /** Optional — clicking the logo opens this in a new tab. */
  url?: string;
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

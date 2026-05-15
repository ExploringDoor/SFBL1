// Single source of truth for LBDC tenant-config values that were
// duplicated across the seed and the one-shot patch scripts.
//
// Audit H6: `stat_columns` lived in both
// scripts/seed-lbdc-to-firestore.ts and scripts/patch-lbdc-stat-columns.ts;
// `nav.hide` lived in both seed-lbdc-to-firestore.ts and
// scripts/patch-lbdc-nav-hide.ts. They were in sync by hand — edit
// one and forget the other and the live tenant silently drifts from
// whatever the next seed run would write. These constants are now
// imported by all three so they cannot diverge.
//
// This module is intentionally side-effect free: no Firebase init,
// no CLI parsing, no env loading. Import the constants only.
//
// NOTE on admin.password (the third H6 sub-point): it is NOT defined
// here on purpose. seed-lbdc-to-firestore.ts writes
// admin.passwordless:true but never admin.password; the password is
// set out-of-band by scripts/patch-lbdc-admin-password.ts and the
// seed's merge:true write leaves it intact on re-run. That split is
// deliberate (keeps the password out of the seed source) and is
// documented at the seed's admin block — not a drift hazard, so it
// stays out of this shared module.

// Captain box-score editor columns for LBDC. The standard 10 plus
// the extra batting columns LBDC's original Supabase site captured
// per line (HBP/SF/SAC/FC/ROE/CS). Order is the rendered column
// order in the editor. Pitching columns are always shown and are
// NOT gated on this list.
export const LBDC_STAT_COLUMNS = [
  "ab",
  "r",
  "h",
  "doubles",
  "triples",
  "hr",
  "rbi",
  "bb",
  "so",
  "sb",
  "hbp",
  "sf",
  "sac",
  "fc",
  "roe",
  "cs",
] as const;

// Nav links suppressed for LBDC. Matched case-insensitively against
// the Nav component's link list (top-level + dropdown children).
// LBDC has no /news page and doesn't share SFBL's
// team-registration / waiver / store surface.
//
// "About SFBL" is intentionally absent — Nav.tsx relabels it to
// "About <tenant abbrev>" for non-SFBL leagues (so LBDC gets a real
// "About LBDC" link backed by /sfbl-info). Hiding it would leave
// LBDC with no about page at all.
export const LBDC_NAV_HIDE = [
  "News",
  "Team Registration",
  "Team Waiver",
  "Store",
] as const;

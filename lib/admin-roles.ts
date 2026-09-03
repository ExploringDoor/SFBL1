// Scoped admin roles: an extra password that opens PART of the admin.
//
// WHY THIS EXISTS. Until 2026-09-01 a league had exactly one admin password
// and one role, and it opened all 28 tabs and all 39 admin endpoints. Mike
// asked for two people to have narrower access: his umpire in chief, "just to
// see umpire stuff", and his assistant, to "do schedules, send messages out to
// coaches, do makeups, input scores, update standings, and get emails once
// coaches send in scores and the scores don't match".
//
// Handing either of them the existing password would also have handed over the
// Payments tab and its Square links, every coach's contact details and team
// sign-in code, every registrant's details including the clinic families, and
// the ability to delete a team.
//
// HOW IT FAILS SAFE. The claim value stays a plain string, and every one of the
// 37 pre-existing admin routes tests it with `!== "admin"`. A scoped claim of
// "admin:umpires" therefore fails ALL of them by default, and a route only
// opens up when someone deliberately adds a scope check to it. Adding a role
// can never silently widen access to code written before the role existed.
//
// WRITES STILL GO THROUGH THE API. The admin tabs read Firestore straight from
// the browser but every mutation posts to an /api/admin-* route, so the
// firestore.rules change that accompanies this only relaxes READS, and only on
// the two collections these roles actually need. Writes stay full-admin.

/** A unit of admin access. Deliberately matches the admin page's tab keys, so
 *  the tab strip and the API gates cannot describe different things. */
export type AdminScope =
  | "umpires"
  | "scores"
  | "schedule"
  | "schedule-gen"
  | "score-disputes"
  | "broadcast"
  | "teams";

export const ALL_SCOPES: readonly AdminScope[] = [
  "umpires",
  "scores",
  "schedule",
  "schedule-gen",
  "score-disputes",
  "broadcast",
  "teams",
] as const;

/** The roles a league can hand out, and what each opens.
 *
 *  Keyed by the id that appears in the claim ("admin:umpires"). Adding a role
 *  here is not enough on its own: its password has to be configured on the
 *  league, and any API route it needs has to accept the scope explicitly. */
export const ADMIN_ROLES: Record<
  string,
  { label: string; scopes: readonly AdminScope[] }
> = {
  // The umpire in chief. The umpire roster and assignments, read AND write,
  // and nothing else. Started read-only on Mike's "just to see umpire stuff",
  // widened the same day on "let the umpire edit his page": he is the one who
  // knows who is available, and the only thing the role can reach is umpires.
  umpires: { label: "Umpires", scopes: ["umpires"] },
  // The assistant. Schedules, makeups, scores, standings and coach messages.
  // Standings are derived from scores rather than edited, so "update
  // standings" is covered by the scores scope plus the recalc endpoint.
  scheduler: {
    label: "Scheduling and scores",
    // "teams" added 2026-09-03: Mike asked for Kaitlin to have "roster access
    // and she need to see the teams in each division". The Teams tab is both,
    // it lists every team with its division and expands to the roster.
    //
    // It is NOT full team control. /api/admin-team refuses `delete` to a
    // scoped caller, and /api/admin-contacts redacts email and phone, because
    // that endpoint returns every player's contact details and the players are
    // children. She asked to see rosters, not for a contact dump.
    scopes: [
      "scores",
      "schedule",
      "schedule-gen",
      "score-disputes",
      "broadcast",
      "teams",
    ],
  },
};

/** What a caller is allowed to do in one league. */
export interface AdminAccess {
  /** The original, unrestricted admin. */
  full: boolean;
  /** Scopes this caller holds. A full admin holds every scope. */
  scopes: Set<AdminScope>;
  /** Role id, for the audit log and the admin header. Null for a full admin. */
  roleId: string | null;
}

const NONE: AdminAccess = { full: false, scopes: new Set(), roleId: null };

/**
 * Read a league claim value into an access decision.
 *
 * Accepts the exact strings this platform mints and nothing else:
 *   "admin"            → everything, as before
 *   "admin:<roleId>"   → the scopes that role declares
 * Anything else, including a captain claim, gets no admin access at all.
 */
export function accessFromClaim(claim: unknown): AdminAccess {
  if (claim === "admin") {
    return { full: true, scopes: new Set(ALL_SCOPES), roleId: null };
  }
  if (typeof claim !== "string" || !claim.startsWith("admin:")) return NONE;
  const roleId = claim.slice("admin:".length);
  const role = ADMIN_ROLES[roleId];
  if (!role) return NONE;
  return { full: false, scopes: new Set(role.scopes), roleId };
}

/** Pull the claim for one league out of a decoded Firebase token. */
export function accessFor(
  // Record rather than `{ leagues?: unknown }`: Firebase's DecodedIdToken has
  // an index signature, and TypeScript's weak-type check rejects it against a
  // shape whose properties are all optional.
  decodedToken: Record<string, unknown> | null | undefined,
  leagueId: string,
): AdminAccess {
  const leagues = (decodedToken?.leagues ?? {}) as Record<string, unknown>;
  return accessFromClaim(leagues[leagueId]);
}

/**
 * The one check an API route should make.
 *
 * Call it INSTEAD OF `leagues[leagueId] !== "admin"`, passing the scope that
 * route belongs to. A full admin always passes. Routes that were never given a
 * scope keep their original check and stay full-admin-only, which is the point.
 */
export function hasScope(
  decodedToken: Record<string, unknown> | null | undefined,
  leagueId: string,
  scope: AdminScope,
): boolean {
  const a = accessFor(decodedToken, leagueId);
  return a.full || a.scopes.has(scope);
}

/** Admin tab keys a caller may see, given their access.
 *
 *  A full admin is returned null, meaning "no filtering", so the tab strip
 *  keeps its existing order and any tab added later shows up for the owner
 *  without anyone remembering this file.
 *
 *  NOT named visibleTabs: app/admin/page.tsx already has a function of that
 *  name doing per-TENANT hiding, and the two filters compose rather than
 *  replace each other. */
export function scopedTabKeys(a: AdminAccess): Set<string> | null {
  if (a.full) return null;
  return new Set(a.scopes);
}

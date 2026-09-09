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
//
// CONFIG-DEFINED ROLES AND TOWNS (2026-09-09, ETBL). East Texas Basketball is
// run by one commissioner per town, and each needs a password that enters
// scores for THEIR town's games and nothing else. Two additions:
//
//   1. A role the table below does not know can still be configured on the
//      league doc with its own `scopes` list (see resolveConfiguredRole).
//      /api/public-admin-claim expands those scopes into the token once, at
//      mint time — the same trust the Firestore rules already place in
//      `admin_scopes` — and accessFromClaim reads them back ONLY when the
//      token's `admin_role` names that very claim. A static role in the table
//      always wins over the token: Island's assistant keeps exactly what the
//      table says however her token was minted.
//   2. A role may carry a `town`. It travels as `admin_town` and is
//      intersected with TOWN_SCOPES: a town can narrow a role, never widen it,
//      because only the routes listed under TOWN_SCOPES know to check it. The
//      check itself lives in lib/admin-town.ts (server) and the routes that
//      write scores. Rules never read admin_town.
//
// One consequence worth naming: /api/recalc accepts the "scores" scope, so a
// commissioner can trigger a league-wide stat recalc. It is idempotent and the
// batch score endpoint already runs it after every save, so that is fine.

/** A unit of admin access. Deliberately matches the admin page's tab keys, so
 *  the tab strip and the API gates cannot describe different things. */
export type AdminScope =
  | "umpires"
  | "scores"
  | "schedule"
  | "schedule-gen"
  | "score-disputes"
  | "broadcast"
  | "teams"
  | "fields"
  | "rules"
  // The game-day job board (clock, scorebook, snack bar). Opened for full
  // admins and for the town commissioner role; the routes that write shifts
  // check this scope.
  | "volunteers";

export const ALL_SCOPES: readonly AdminScope[] = [
  "umpires",
  "scores",
  "schedule",
  "schedule-gen",
  "score-disputes",
  "broadcast",
  "teams",
  "fields",
  "rules",
  "volunteers",
] as const;

/** The scopes whose routes enforce `admin_town`. A town-bound role is
 *  intersected with this list at mint time and again on every read, so adding
 *  a scope here is a deliberate one-word widening — and the route for that
 *  scope MUST call checkGamesInTown (or its equivalent) first, or the town
 *  binding means nothing there. */
export const TOWN_SCOPES: readonly AdminScope[] = ["scores", "volunteers"];

/** Role ids are interpolated into a Firestore rules regex
 *  (`^admin:[a-z-]+$` in firestore.rules), so they are pinned to the same
 *  alphabet here. `Mineola`, `mineola2` and `big_sandy` are all refused. */
export const ROLE_ID_RE = /^[a-z][a-z-]{0,31}$/;

const TOWN_MAX = 60;

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
      // "fields" added 2026-09-06, Mike: "give Kaitlin access to fields so she
      // can add and delete fields." Fields ARE scheduling: she books them and
      // she is the one who hears a park is closed. Needing Mike to add a
      // location before she can schedule on it made him the bottleneck on her
      // own job. Writes go through /api/admin-fields, which keeps the previous
      // list so a deletion is recoverable.
      "fields",
      // "rules" added 2026-09-06, Mike: "Rules button can you give her access
      // too so she can edit."
      //
      // This file said the opposite yesterday: the rulebook is policy, and the
      // assistant schedules games. Mike owns the league and asked directly, so
      // it changes. Worth writing down that it is safe rather than merely
      // asked for: every save snapshots the previous version, the Undo control
      // reads those back, and the audit log records who saved what. A bad edit
      // is a thirty second fix by either of them.
      //
      // It stays EDIT ONLY. canEditStructured still refuses to create a
      // rulebook where there is none, which is what protects the leagues whose
      // rules live in a different document.
      "rules",
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
  /** The town this role is bound to, or null. Only the routes behind
   *  TOWN_SCOPES act on it; everything else ignores it. */
  town: string | null;
}

const NONE: AdminAccess = {
  full: false,
  scopes: new Set(),
  roleId: null,
  town: null,
};

/** Normalise a town / organization string for comparison. Both sides of
 *  every town check go through this, so "Mineola", " mineola " and "MINEOLA"
 *  are one town — the same rule the schedule generator uses for clubs. */
export function townKey(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

/** Is a team whose `organization` is `teamOrganization` in `town`? A blank on
 *  either side is a no: a team nobody assigned belongs to nobody. */
export function teamInTown(teamOrganization: unknown, town: unknown): boolean {
  const k = townKey(town);
  return k !== "" && townKey(teamOrganization) === k;
}

function validTown(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length >= 1 && t.length <= TOWN_MAX ? t : null;
}

function filterScopes(v: unknown): AdminScope[] {
  if (!Array.isArray(v)) return [];
  const known = new Set<string>(ALL_SCOPES);
  const out: AdminScope[] = [];
  for (const s of v) {
    if (typeof s === "string" && known.has(s) && !out.includes(s as AdminScope)) {
      out.push(s as AdminScope);
    }
  }
  return out;
}

function narrowToTown(scopes: AdminScope[], town: string | null): AdminScope[] {
  return town ? scopes.filter((s) => TOWN_SCOPES.includes(s)) : scopes;
}

/** What a configured role resolves to, before any token exists. */
export interface ResolvedRole {
  scopes: AdminScope[];
  town: string | null;
}

/**
 * Resolve one entry of `leagues/{id}.admin.roles` into the scopes and town it
 * grants, or null if it grants nothing and must not be minted.
 *
 *   roles: {
 *     umpires:  { password: "…" },                                   // table role
 *     mineola:  { password: "…", scopes: ["scores"], town: "Mineola" } // config role
 *   }
 *
 * Precedence: an id the table knows takes the table's scopes and ignores
 * `cfg.scopes`; an unknown id needs a non-empty `cfg.scopes` of real scope
 * names. A `town`, on either kind, narrows the scopes to TOWN_SCOPES. A town
 * that is present but unusable (not a string, blank, too long) makes the whole
 * role unmintable rather than quietly minting it town-less.
 */
export function resolveConfiguredRole(
  roleId: string,
  cfg: unknown,
): ResolvedRole | null {
  if (!ROLE_ID_RE.test(roleId)) return null;
  const c = (cfg && typeof cfg === "object" ? cfg : {}) as {
    scopes?: unknown;
    town?: unknown;
  };
  const townGiven = c.town !== undefined && c.town !== null && c.town !== "";
  const town = validTown(c.town);
  if (townGiven && town === null) return null;

  const table = ADMIN_ROLES[roleId];
  let scopes: AdminScope[];
  if (table) {
    scopes = [...table.scopes];
  } else {
    scopes = filterScopes(c.scopes);
    if (scopes.length === 0) return null;
  }
  scopes = narrowToTown(scopes, town);
  if (scopes.length === 0) return null;
  return { scopes, town };
}

/**
 * Read a league claim value into an access decision.
 *
 * Accepts the exact strings this platform mints and nothing else:
 *   "admin"            → everything, as before
 *   "admin:<roleId>"   → the scopes that role declares
 * Anything else, including a captain claim, gets no admin access at all.
 *
 * `token` is the rest of the decoded token. It is consulted for two things
 * only: `admin_town` (any scoped role), and `admin_scopes` for a role the
 * table does not know — and then only when `admin_role` names this claim's
 * role, so scopes minted for one role can never be read as another's.
 */
export function accessFromClaim(
  claim: unknown,
  token?: Record<string, unknown> | null,
): AdminAccess {
  if (claim === "admin") {
    return { full: true, scopes: new Set(ALL_SCOPES), roleId: null, town: null };
  }
  if (typeof claim !== "string" || !claim.startsWith("admin:")) return NONE;
  const roleId = claim.slice("admin:".length);
  const town = validTown(token?.admin_town);

  const table = ADMIN_ROLES[roleId];
  let scopes: AdminScope[];
  if (table) {
    scopes = [...table.scopes];
  } else {
    if (!token || token.admin_role !== roleId) return NONE;
    scopes = filterScopes(token.admin_scopes);
    if (scopes.length === 0) return NONE;
  }
  scopes = narrowToTown(scopes, town);
  if (scopes.length === 0) return NONE;
  return { full: false, scopes: new Set(scopes), roleId, town };
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
  return accessFromClaim(leagues[leagueId], decodedToken);
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

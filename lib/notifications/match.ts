// The 9-step filter chain that decides which `/notification_tokens`
// docs should receive a given push payload. Pure function — no
// Firestore, no FCM, no auth — so it can be unit-tested directly and
// the integration test can reach in to assert cross-tenant isolation.
//
// Step order is non-negotiable. Step 1 (leagueId) MUST be first; it
// is the multi-tenant boundary and the cross-tenant rules test asserts
// no other filter can supersede it.
//
// Mirrors send-notification.js:199-267 (DVSL) with the leagueId filter
// inserted at the front. Empty `categories[]` deliberately delivers
// everything (DVSL backward-compat, line 236) — empty means "no prefs
// stored yet, treat as default subscribe-to-all."
//
// `team_chat` and `captains_chat` have category-specific audience rules
// that other categories don't:
//   - team_chat: must intersect `authed_teams` (which teams the recipient
//     is rostered/captaining on), NOT `teams` (their subscription list).
//     A captain can mute team-chat overall via prefs, but they cannot
//     receive a team_chat for a team they aren't on, period.
//   - captains_chat: requires `is_captain_authed === true`. Audience
//     filter (`teams`) is ignored — captains_chat is a single league-
//     wide thread.

import type { NotificationCategory } from "./categories";

export interface TokenRow {
  // Doc id of the notification_tokens row, used for dead-token pruning.
  docId: string;
  // The fields below come straight from the doc data — typed loosely
  // because Firestore returns `any`-shaped values. Match enforces the
  // shape it needs.
  token: string;
  leagueId: string;
  categories?: string[];
  teams?: string[];
  authed_teams?: string[];
  is_captain_authed?: boolean;
  is_admin?: boolean;
  player_id?: string | null;
  auth_uid?: string;
}

export interface SendPayload {
  // Required filter inputs
  leagueId: string;
  category: NotificationCategory;

  // Audience inputs (a request can pin a single team or list of teams,
  // or skip team-scoping entirely).
  team?: string;
  teams?: string[];
  rosterOnly?: boolean;
  adminOnly?: boolean;

  // Suppression
  excludeToken?: string;
  excludePlayerIds?: string[];
}

export interface MatchResult {
  matched: TokenRow[];
  // Per-step counts for debugging / push log entry.
  rejected: {
    leagueMismatch: number;
    notAdmin: number;
    excludePlayer: number;
    rosterOnly: number;
    categoryNotSubscribed: number;
    teamChatNotInAuthedTeams: number;
    captainsChatNotCaptain: number;
    teamSubscriptionMismatch: number;
    excludeToken: number;
  };
}

/** Pure 9-step filter — see file header for the full step ordering. */
export function matchTokens(
  tokens: TokenRow[],
  payload: SendPayload,
): MatchResult {
  const matched: TokenRow[] = [];
  const rejected = {
    leagueMismatch: 0,
    notAdmin: 0,
    excludePlayer: 0,
    rosterOnly: 0,
    categoryNotSubscribed: 0,
    teamChatNotInAuthedTeams: 0,
    captainsChatNotCaptain: 0,
    teamSubscriptionMismatch: 0,
    excludeToken: 0,
  };

  // Build the audience-team set once.
  const teamWanted = new Set<string>();
  if (payload.team) teamWanted.add(payload.team);
  if (payload.teams) for (const t of payload.teams) teamWanted.add(t);

  const excludePlayerIds = new Set(payload.excludePlayerIds ?? []);

  for (const tok of tokens) {
    // STEP 1 — leagueId. Multi-tenant boundary. NEVER reorder this.
    if (tok.leagueId !== payload.leagueId) {
      rejected.leagueMismatch++;
      continue;
    }

    // STEP 2 — adminOnly: drop tokens not flagged is_admin. When set,
    // we BYPASS the per-recipient category check (admins receive their
    // own category alerts even if they have `admin` toggled off — DVSL
    // send-notification.js:215, line 232 comment).
    if (payload.adminOnly) {
      if (tok.is_admin !== true) {
        rejected.notAdmin++;
        continue;
      }
    }

    // STEP 3 — excludePlayerIds.
    if (
      excludePlayerIds.size &&
      tok.player_id &&
      excludePlayerIds.has(tok.player_id)
    ) {
      rejected.excludePlayer++;
      continue;
    }

    // STEP 4 — rosterOnly: tokens without a player_id are skipped.
    if (payload.rosterOnly && !tok.player_id) {
      rejected.rosterOnly++;
      continue;
    }

    // STEP 5 — category prefs. Empty array = subscribe-to-all
    // (DVSL backward-compat, send-notification.js:236). Skipped
    // entirely when adminOnly is set.
    if (!payload.adminOnly) {
      const cats = tok.categories ?? [];
      if (cats.length > 0 && !cats.includes(payload.category)) {
        rejected.categoryNotSubscribed++;
        continue;
      }
    }

    // STEP 6 — category-specific audience checks.
    if (payload.category === "team_chat") {
      // team_chat must intersect authed_teams (where the recipient is
      // rostered/captaining), NOT the user-subscribed teams list.
      const authed = new Set(tok.authed_teams ?? []);
      let overlap = false;
      for (const t of teamWanted) {
        if (authed.has(t)) {
          overlap = true;
          break;
        }
      }
      if (teamWanted.size && !overlap) {
        rejected.teamChatNotInAuthedTeams++;
        continue;
      }
    } else if (payload.category === "captains_chat") {
      if (tok.is_captain_authed !== true) {
        rejected.captainsChatNotCaptain++;
        continue;
      }
      // captains_chat ignores teamWanted — single league-wide thread.
    } else {
      // All other team-scoped categories: empty subscription = match-all,
      // else require overlap.
      const subs = tok.teams ?? [];
      if (subs.length > 0 && teamWanted.size > 0) {
        let overlap = false;
        for (const t of teamWanted) {
          if (subs.includes(t)) {
            overlap = true;
            break;
          }
        }
        if (!overlap) {
          rejected.teamSubscriptionMismatch++;
          continue;
        }
      }
    }

    // STEP 7 — excludeToken (suppress sender's own device).
    if (payload.excludeToken && tok.token === payload.excludeToken) {
      rejected.excludeToken++;
      continue;
    }

    matched.push(tok);
  }

  return { matched, rejected };
}

/** FCM error codes that indicate a token is permanently dead and the
 * doc should be pruned. Mirrors send-notification.js:139-147. */
export const DEAD_TOKEN_ERROR_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument", // FCM 400 on malformed token
]);

export function isDeadTokenError(err: unknown): boolean {
  if (!err) return false;
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message?: unknown }).message ?? "")
        : String(err);
  if (msg.includes("UNREGISTERED")) return true;
  if (msg.includes("registration-token-not-registered")) return true;
  if (/FCM\s+404/.test(msg)) return true;
  // firebase-admin SDK error code path:
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string"
  ) {
    return DEAD_TOKEN_ERROR_CODES.has(
      (err as { code: string }).code,
    );
  }
  return false;
}

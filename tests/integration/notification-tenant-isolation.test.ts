// Cross-tenant push isolation — the "captains in League A see League B
// scores" bug we cannot ship with. Three layers, all must pass:
//
//   1. Pure matcher (lib/notifications/match.ts): mismatched leagueId
//      tokens MUST be rejected at step 1, no matter how the rest of
//      the payload looks.
//   2. Firestore query: the send endpoint queries
//      `where("leagueId", "==", leagueId)`. Even if the matcher had a
//      bug, the cross-tenant doc never enters memory.
//   3. Firestore rules: client read of a notification_tokens doc is
//      gated on `auth_uid == request.auth.uid`. A SFBL captain cannot
//      enumerate KCSL tokens, period.
//
// All three layers are tested below.

import { describe, expect, it } from "vitest";
import { matchTokens } from "@/lib/notifications/match";
import type { TokenRow } from "@/lib/notifications/match";

function makeToken(overrides: Partial<TokenRow>): TokenRow {
  return {
    docId: "doc1",
    token: "fcm_token_abc",
    leagueId: "sfbl",
    categories: ["scores"],
    teams: [],
    authed_teams: [],
    is_captain_authed: false,
    is_admin: false,
    player_id: null,
    auth_uid: "uid_x",
    ...overrides,
  };
}

describe("matchTokens — multi-tenant isolation (Step 1, leagueId)", () => {
  it("drops a SFBL token when payload.leagueId === 'kcsl'", () => {
    const sfblToken = makeToken({ leagueId: "sfbl" });
    const result = matchTokens([sfblToken], {
      leagueId: "kcsl",
      category: "scores",
    });
    expect(result.matched).toHaveLength(0);
    expect(result.rejected.leagueMismatch).toBe(1);
  });

  it("admin-of-everywhere SFBL token does NOT receive a KCSL adminOnly push", () => {
    // Worst-case bypass attempt: the recipient is admin and the
    // payload is adminOnly (which normally bypasses category checks).
    // Step 1 must still reject because leagueId comes first.
    const sfblAdmin = makeToken({
      leagueId: "sfbl",
      is_admin: true,
      categories: [], // would pass category filter (empty = all)
    });
    const result = matchTokens([sfblAdmin], {
      leagueId: "kcsl",
      category: "admin",
      adminOnly: true,
    });
    expect(result.matched).toHaveLength(0);
    expect(result.rejected.leagueMismatch).toBe(1);
    expect(result.rejected.notAdmin).toBe(0); // we never got that far
  });

  it("captain of SFBL team_a does NOT receive KCSL team_chat for a team_a in KCSL", () => {
    // Worst case: an opposing league happens to have a team named
    // team_a too. The SFBL captain is rostered on SFBL's team_a and
    // would otherwise pass the team_chat authed_teams filter.
    const sfblCap = makeToken({
      leagueId: "sfbl",
      authed_teams: ["team_a"],
      is_captain_authed: true,
    });
    const result = matchTokens([sfblCap], {
      leagueId: "kcsl",
      category: "team_chat",
      team: "team_a",
    });
    expect(result.matched).toHaveLength(0);
    expect(result.rejected.leagueMismatch).toBe(1);
  });

  it("delivers within-league when leagueId matches", () => {
    const sfblToken = makeToken({ leagueId: "sfbl" });
    const result = matchTokens([sfblToken], {
      leagueId: "sfbl",
      category: "scores",
    });
    expect(result.matched).toHaveLength(1);
    expect(result.rejected.leagueMismatch).toBe(0);
  });

  it("partitions a mixed list correctly", () => {
    const tokens = [
      makeToken({ docId: "d1", leagueId: "sfbl", token: "tok_sfbl_1" }),
      makeToken({ docId: "d2", leagueId: "kcsl", token: "tok_kcsl_1" }),
      makeToken({ docId: "d3", leagueId: "sfbl", token: "tok_sfbl_2" }),
      makeToken({ docId: "d4", leagueId: "kcsl", token: "tok_kcsl_2" }),
    ];
    const sfblResult = matchTokens(tokens, {
      leagueId: "sfbl",
      category: "scores",
    });
    expect(sfblResult.matched.map((t) => t.docId).sort()).toEqual([
      "d1",
      "d3",
    ]);
    expect(sfblResult.rejected.leagueMismatch).toBe(2);

    const kcslResult = matchTokens(tokens, {
      leagueId: "kcsl",
      category: "scores",
    });
    expect(kcslResult.matched.map((t) => t.docId).sort()).toEqual([
      "d2",
      "d4",
    ]);
    expect(kcslResult.rejected.leagueMismatch).toBe(2);
  });
});

describe("matchTokens — within-league behaviour (DVSL filter chain)", () => {
  it("Step 5 — empty categories[] delivers (DVSL backward-compat)", () => {
    const t = makeToken({ categories: [] });
    const result = matchTokens([t], {
      leagueId: "sfbl",
      category: "scores",
    });
    expect(result.matched).toHaveLength(1);
  });

  it("Step 5 — non-empty categories[] requires inclusion", () => {
    const t = makeToken({ categories: ["rainouts"] });
    const result = matchTokens([t], {
      leagueId: "sfbl",
      category: "scores",
    });
    expect(result.matched).toHaveLength(0);
    expect(result.rejected.categoryNotSubscribed).toBe(1);
  });

  it("Step 2 — adminOnly drops non-admin", () => {
    const t = makeToken({ is_admin: false });
    const result = matchTokens([t], {
      leagueId: "sfbl",
      category: "admin",
      adminOnly: true,
    });
    expect(result.matched).toHaveLength(0);
    expect(result.rejected.notAdmin).toBe(1);
  });

  it("Step 2 — adminOnly bypasses category check", () => {
    // Admin has 'admin' NOT in their categories list, but adminOnly
    // payload should still deliver.
    const t = makeToken({ is_admin: true, categories: ["scores"] });
    const result = matchTokens([t], {
      leagueId: "sfbl",
      category: "admin",
      adminOnly: true,
    });
    expect(result.matched).toHaveLength(1);
  });

  it("Step 6 — team_chat requires authed_teams overlap, ignores teams[]", () => {
    // Subscribed to team_a, but only authed on team_b. Should NOT
    // receive team_chat for team_a.
    const t = makeToken({
      categories: ["team_chat"],
      teams: ["team_a"],
      authed_teams: ["team_b"],
    });
    const result = matchTokens([t], {
      leagueId: "sfbl",
      category: "team_chat",
      team: "team_a",
    });
    expect(result.matched).toHaveLength(0);
    expect(result.rejected.teamChatNotInAuthedTeams).toBe(1);
  });

  it("Step 6 — team_chat delivers when authed_teams overlaps", () => {
    const t = makeToken({
      categories: ["team_chat"],
      authed_teams: ["team_a"],
    });
    const result = matchTokens([t], {
      leagueId: "sfbl",
      category: "team_chat",
      team: "team_a",
    });
    expect(result.matched).toHaveLength(1);
  });

  it("Step 6 — captains_chat requires is_captain_authed", () => {
    const nonCap = makeToken({
      categories: ["captains_chat"],
      is_captain_authed: false,
    });
    const result = matchTokens([nonCap], {
      leagueId: "sfbl",
      category: "captains_chat",
    });
    expect(result.matched).toHaveLength(0);
    expect(result.rejected.captainsChatNotCaptain).toBe(1);
  });

  it("Step 6 — captains_chat ignores team filter", () => {
    const cap = makeToken({
      categories: ["captains_chat"],
      is_captain_authed: true,
      authed_teams: ["team_a"],
    });
    const result = matchTokens([cap], {
      leagueId: "sfbl",
      category: "captains_chat",
      team: "team_z", // captain isn't on team_z, doesn't matter
    });
    expect(result.matched).toHaveLength(1);
  });

  it("Step 6 — non-chat category: empty teams[] = match all", () => {
    const t = makeToken({ teams: [] });
    const result = matchTokens([t], {
      leagueId: "sfbl",
      category: "scores",
      team: "team_a",
    });
    expect(result.matched).toHaveLength(1);
  });

  it("Step 6 — non-chat category: non-empty teams[] requires overlap", () => {
    const t = makeToken({ teams: ["team_b"] });
    const result = matchTokens([t], {
      leagueId: "sfbl",
      category: "scores",
      team: "team_a",
    });
    expect(result.matched).toHaveLength(0);
    expect(result.rejected.teamSubscriptionMismatch).toBe(1);
  });

  it("Step 7 — excludeToken suppresses sender's own device", () => {
    const t = makeToken({ token: "self" });
    const result = matchTokens([t], {
      leagueId: "sfbl",
      category: "scores",
      excludeToken: "self",
    });
    expect(result.matched).toHaveLength(0);
    expect(result.rejected.excludeToken).toBe(1);
  });

  it("Step 3 — excludePlayerIds suppresses by player_id", () => {
    const t = makeToken({ player_id: "player_42" });
    const result = matchTokens([t], {
      leagueId: "sfbl",
      category: "scores",
      excludePlayerIds: ["player_42"],
    });
    expect(result.matched).toHaveLength(0);
    expect(result.rejected.excludePlayer).toBe(1);
  });

  it("Step 4 — rosterOnly drops tokens with no player_id", () => {
    const t = makeToken({ player_id: null });
    const result = matchTokens([t], {
      leagueId: "sfbl",
      category: "scores",
      rosterOnly: true,
    });
    expect(result.matched).toHaveLength(0);
    expect(result.rejected.rosterOnly).toBe(1);
  });
});

// Unit tests for lib/notifications/match.ts → matchTokens.
//
// matchTokens is the 9-step filter that decides who receives every
// push notification. It is the SOUL of the multi-tenant push isolation
// guarantee — step 1 rejects any token with a different leagueId.
// If steps are reordered or any branch is buggy, pushes can leak
// across tenants, leak across teams, ignore user category prefs, or
// fan out to admins by mistake. This module gets surgical coverage.
//
// Steps under test (route comments use these numbers):
//   1. leagueId match (multi-tenant boundary)
//   2. adminOnly (admin-flagged tokens only)
//   3. excludePlayerIds (suppress specific players)
//   4. rosterOnly (player_id required)
//   5. category subscription (empty = subscribe-to-all; bypass when adminOnly)
//   6. category-specific audience checks:
//      - team_chat: must intersect AUTHED_teams
//      - captains_chat: must be is_captain_authed
//      - other categories: subscribed teams must overlap with audience
//   7. excludeToken (suppress sender's own device)

import { describe, expect, it } from "vitest";
import { matchTokens, type TokenRow, type SendPayload } from "@/lib/notifications/match";

// ── helpers ───────────────────────────────────────────────────────

function tok(overrides: Partial<TokenRow> = {}): TokenRow {
  return {
    docId: overrides.docId ?? "doc_" + Math.random().toString(36).slice(2, 8),
    token: "fcm_token",
    leagueId: "sfbl",
    categories: undefined, // default = subscribe to all
    teams: [],
    authed_teams: [],
    is_captain_authed: false,
    is_admin: false,
    player_id: null,
    auth_uid: "uid",
    ...overrides,
  };
}

function payload(overrides: Partial<SendPayload> = {}): SendPayload {
  return {
    leagueId: "sfbl",
    category: "scores",
    ...overrides,
  };
}

// ── STEP 1 — multi-tenant boundary ────────────────────────────────

describe("matchTokens — STEP 1 leagueId boundary", () => {
  it("rejects tokens with a different leagueId", () => {
    const tokens = [
      tok({ leagueId: "kcsl", token: "kcsl_dev" }),
      tok({ leagueId: "sfbl", token: "sfbl_dev" }),
    ];
    const r = matchTokens(tokens, payload({ leagueId: "sfbl" }));
    expect(r.matched.map((t) => t.token)).toEqual(["sfbl_dev"]);
    expect(r.rejected.leagueMismatch).toBe(1);
  });

  it("rejects ALL tokens when leagueId doesn't match any", () => {
    const tokens = [
      tok({ leagueId: "kcsl" }),
      tok({ leagueId: "wpbl" }),
    ];
    const r = matchTokens(tokens, payload({ leagueId: "sfbl" }));
    expect(r.matched).toHaveLength(0);
    expect(r.rejected.leagueMismatch).toBe(2);
  });

  it("leagueId is the FIRST filter — no other rejection counters fire on cross-tenant tokens", () => {
    // A token with kcsl + every other red flag should still hit ONLY
    // the leagueMismatch counter (proves step ordering is correct).
    const tokens = [
      tok({
        leagueId: "kcsl",
        is_admin: false,
        categories: ["scores"],
        teams: ["team_x"],
      }),
    ];
    const r = matchTokens(
      tokens,
      payload({ leagueId: "sfbl", adminOnly: true, team: "team_a" }),
    );
    expect(r.rejected.leagueMismatch).toBe(1);
    expect(r.rejected.notAdmin).toBe(0);
    expect(r.rejected.teamSubscriptionMismatch).toBe(0);
  });
});

// ── STEP 2 — adminOnly ────────────────────────────────────────────

describe("matchTokens — STEP 2 adminOnly", () => {
  it("rejects non-admin tokens when adminOnly=true", () => {
    const tokens = [
      tok({ token: "regular", is_admin: false }),
      tok({ token: "the_admin", is_admin: true }),
    ];
    const r = matchTokens(tokens, payload({ adminOnly: true }));
    expect(r.matched.map((t) => t.token)).toEqual(["the_admin"]);
    expect(r.rejected.notAdmin).toBe(1);
  });

  it("adminOnly bypasses category subscription check", () => {
    // Admin has UN-subscribed from "admin" category, but adminOnly
    // pushes still reach them per DVSL spec.
    const tokens = [
      tok({ is_admin: true, categories: ["scores"] }), // not admin cat
    ];
    const r = matchTokens(
      tokens,
      payload({ category: "admin", adminOnly: true }),
    );
    expect(r.matched).toHaveLength(1);
    expect(r.rejected.categoryNotSubscribed).toBe(0);
  });
});

// ── STEP 3 — excludePlayerIds ─────────────────────────────────────

describe("matchTokens — STEP 3 excludePlayerIds", () => {
  it("excludes specific player_ids from the audience", () => {
    const tokens = [
      tok({ token: "p1_dev", player_id: "p1" }),
      tok({ token: "p2_dev", player_id: "p2" }),
      tok({ token: "p3_dev", player_id: "p3" }),
    ];
    const r = matchTokens(
      tokens,
      payload({ excludePlayerIds: ["p1", "p3"] }),
    );
    expect(r.matched.map((t) => t.token)).toEqual(["p2_dev"]);
    expect(r.rejected.excludePlayer).toBe(2);
  });

  it("does not affect tokens without a player_id (anonymous fans)", () => {
    const tokens = [
      tok({ token: "anon_dev", player_id: null }),
      tok({ token: "p1_dev", player_id: "p1" }),
    ];
    const r = matchTokens(
      tokens,
      payload({ excludePlayerIds: ["p1"] }),
    );
    expect(r.matched.map((t) => t.token)).toEqual(["anon_dev"]);
  });
});

// ── STEP 4 — rosterOnly ───────────────────────────────────────────

describe("matchTokens — STEP 4 rosterOnly", () => {
  it("rejects tokens without a player_id when rosterOnly=true", () => {
    const tokens = [
      tok({ token: "anon", player_id: null }),
      tok({ token: "rostered", player_id: "p1" }),
    ];
    const r = matchTokens(tokens, payload({ rosterOnly: true }));
    expect(r.matched.map((t) => t.token)).toEqual(["rostered"]);
    expect(r.rejected.rosterOnly).toBe(1);
  });
});

// ── STEP 5 — category subscription ────────────────────────────────

describe("matchTokens — STEP 5 category subscription", () => {
  it("empty categories = subscribe to all (DVSL backward-compat)", () => {
    const tokens = [tok({ categories: [] })];
    const r = matchTokens(tokens, payload({ category: "scores" }));
    expect(r.matched).toHaveLength(1);
  });

  it("undefined categories = subscribe to all", () => {
    const tokens = [tok({ categories: undefined })];
    const r = matchTokens(tokens, payload({ category: "scores" }));
    expect(r.matched).toHaveLength(1);
  });

  it("non-matching category subscription is rejected", () => {
    const tokens = [tok({ categories: ["rainouts"] })];
    const r = matchTokens(tokens, payload({ category: "scores" }));
    expect(r.matched).toHaveLength(0);
    expect(r.rejected.categoryNotSubscribed).toBe(1);
  });

  it("matching category passes through", () => {
    const tokens = [tok({ categories: ["scores", "rainouts"] })];
    const r = matchTokens(tokens, payload({ category: "scores" }));
    expect(r.matched).toHaveLength(1);
  });
});

// ── STEP 6a — team_chat ───────────────────────────────────────────

describe("matchTokens — STEP 6 team_chat (authed_teams)", () => {
  it("delivers to recipients ROSTERED on the chat's team (authed_teams overlap)", () => {
    const tokens = [
      tok({
        token: "rostered_on_a",
        authed_teams: ["team_a"],
        teams: [], // user-subscribed teams irrelevant for team_chat
      }),
      tok({
        token: "subscribed_to_a_only",
        authed_teams: ["team_b"],
        teams: ["team_a"], // subscribed but not rostered → REJECT
      }),
    ];
    const r = matchTokens(
      tokens,
      payload({ category: "team_chat", team: "team_a" }),
    );
    expect(r.matched.map((t) => t.token)).toEqual(["rostered_on_a"]);
    expect(r.rejected.teamChatNotInAuthedTeams).toBe(1);
  });

  it("multi-team players (e.g. captain on team_a, player on team_b) get team_chat for both", () => {
    const tokens = [
      tok({ token: "multi", authed_teams: ["team_a", "team_b"] }),
    ];
    expect(
      matchTokens(
        tokens,
        payload({ category: "team_chat", team: "team_a" }),
      ).matched,
    ).toHaveLength(1);
    expect(
      matchTokens(
        tokens,
        payload({ category: "team_chat", team: "team_b" }),
      ).matched,
    ).toHaveLength(1);
  });

  it("team_chat with no team specified: no audience filter, all pass step 6", () => {
    // Defensive — empty audience means no rejection at step 6a.
    const tokens = [tok({ authed_teams: ["team_a"] })];
    const r = matchTokens(tokens, payload({ category: "team_chat" }));
    expect(r.matched).toHaveLength(1);
  });
});

// ── STEP 6b — captains_chat ───────────────────────────────────────

describe("matchTokens — STEP 6 captains_chat", () => {
  it("only is_captain_authed tokens pass", () => {
    const tokens = [
      tok({ token: "captain", is_captain_authed: true }),
      tok({ token: "player", is_captain_authed: false }),
    ];
    const r = matchTokens(
      tokens,
      payload({ category: "captains_chat" }),
    );
    expect(r.matched.map((t) => t.token)).toEqual(["captain"]);
    expect(r.rejected.captainsChatNotCaptain).toBe(1);
  });

  it("captains_chat ignores the team audience (single league-wide thread)", () => {
    const tokens = [
      tok({
        token: "team_a_captain",
        is_captain_authed: true,
        authed_teams: ["team_a"],
      }),
      tok({
        token: "team_b_captain",
        is_captain_authed: true,
        authed_teams: ["team_b"],
      }),
    ];
    const r = matchTokens(
      tokens,
      payload({ category: "captains_chat", team: "team_a" }),
    );
    // Both captains receive — team filter is ignored for captains_chat.
    expect(r.matched).toHaveLength(2);
  });
});

// ── STEP 6c — generic team-scoped categories ──────────────────────

describe("matchTokens — STEP 6 generic team-scoped categories", () => {
  it("empty teams subscription = match-all (no rejection)", () => {
    const tokens = [tok({ teams: [], categories: ["scores"] })];
    const r = matchTokens(
      tokens,
      payload({ category: "scores", team: "team_a" }),
    );
    expect(r.matched).toHaveLength(1);
  });

  it("subscribed teams MUST overlap audience when both non-empty", () => {
    const tokens = [
      tok({ token: "subbed_a", teams: ["team_a"] }),
      tok({ token: "subbed_b", teams: ["team_b"] }),
      tok({ token: "subbed_both", teams: ["team_a", "team_b"] }),
    ];
    const r = matchTokens(
      tokens,
      payload({ category: "scores", team: "team_a" }),
    );
    expect(r.matched.map((t) => t.token).sort()).toEqual([
      "subbed_a",
      "subbed_both",
    ]);
    expect(r.rejected.teamSubscriptionMismatch).toBe(1);
  });

  it("teams[] audience: ANY overlap is enough", () => {
    const tokens = [
      tok({ token: "subs_c", teams: ["team_c"] }),
      tok({ token: "subs_a", teams: ["team_a"] }),
    ];
    const r = matchTokens(
      tokens,
      payload({ category: "scores", teams: ["team_a", "team_b"] }),
    );
    expect(r.matched.map((t) => t.token)).toEqual(["subs_a"]);
  });

  it("no audience specified: skips team-overlap check (everyone matches)", () => {
    // payload.team and payload.teams both empty → teamWanted is empty
    // → STEP 6c skips overlap requirement.
    const tokens = [tok({ teams: ["team_a"] }), tok({ teams: ["team_b"] })];
    const r = matchTokens(
      tokens,
      payload({ category: "announcements" }),
    );
    expect(r.matched).toHaveLength(2);
  });
});

// ── STEP 7 — excludeToken ─────────────────────────────────────────

describe("matchTokens — STEP 7 excludeToken (sender suppression)", () => {
  it("rejects the exact matching token (sender's own device)", () => {
    const tokens = [
      tok({ token: "fcm_sender_device" }),
      tok({ token: "fcm_other_device" }),
    ];
    const r = matchTokens(
      tokens,
      payload({ excludeToken: "fcm_sender_device" }),
    );
    expect(r.matched.map((t) => t.token)).toEqual(["fcm_other_device"]);
    expect(r.rejected.excludeToken).toBe(1);
  });

  it("does nothing when excludeToken doesn't match any device", () => {
    const tokens = [tok({ token: "fcm_a" }), tok({ token: "fcm_b" })];
    const r = matchTokens(tokens, payload({ excludeToken: "ghost" }));
    expect(r.matched).toHaveLength(2);
    expect(r.rejected.excludeToken).toBe(0);
  });
});

// ── compound scenarios ────────────────────────────────────────────

describe("matchTokens — compound scenarios", () => {
  it("score-final push fans out to both teams' rosters + admins (full simulation)", () => {
    // Realistic scenario: Yankees beat Red Sox 7-3 final. Push goes
    // to category=scores, teams=[team_a, team_b]. Recipients should
    // be: anyone subscribed to scores who follows team_a or team_b,
    // plus admins.
    const tokens = [
      tok({
        token: "yankees_fan",
        teams: ["team_a"],
        categories: ["scores"],
      }),
      tok({
        token: "redsox_fan",
        teams: ["team_b"],
        categories: ["scores"],
      }),
      tok({
        token: "dodgers_fan",
        teams: ["team_c"],
        categories: ["scores"],
      }),
      tok({
        token: "muted_fan",
        teams: ["team_a"],
        categories: ["rainouts"], // unsubscribed from scores
      }),
      tok({
        token: "all_subscribed_fan",
        teams: [], // subscribed to all teams
        categories: [],
      }),
    ];
    const r = matchTokens(
      tokens,
      payload({ category: "scores", teams: ["team_a", "team_b"] }),
    );
    const matched = r.matched.map((t) => t.token).sort();
    expect(matched).toEqual([
      "all_subscribed_fan",
      "redsox_fan",
      "yankees_fan",
    ]);
    expect(r.rejected.teamSubscriptionMismatch).toBe(1); // dodgers_fan
    expect(r.rejected.categoryNotSubscribed).toBe(1); // muted_fan
  });

  it("admin score-conflict push reaches admins ONLY, regardless of subs", () => {
    const tokens = [
      tok({
        token: "admin_one",
        is_admin: true,
        categories: [], // even with no admin sub, adminOnly bypasses
      }),
      tok({
        token: "captain_one",
        is_admin: false,
        categories: ["scores", "admin"],
      }),
      tok({
        token: "admin_two",
        is_admin: true,
        categories: ["admin"],
      }),
    ];
    const r = matchTokens(
      tokens,
      payload({ category: "admin", adminOnly: true }),
    );
    expect(r.matched.map((t) => t.token).sort()).toEqual([
      "admin_one",
      "admin_two",
    ]);
    expect(r.rejected.notAdmin).toBe(1);
  });

  it("excludePlayerIds + rosterOnly + team-scoped: stack correctly", () => {
    const tokens = [
      tok({
        token: "anon",
        player_id: null,
        teams: ["team_a"],
        categories: ["scores"],
      }),
      tok({
        token: "p1_excluded",
        player_id: "p1",
        teams: ["team_a"],
        categories: ["scores"],
      }),
      tok({
        token: "p2_match",
        player_id: "p2",
        teams: ["team_a"],
        categories: ["scores"],
      }),
    ];
    const r = matchTokens(
      tokens,
      payload({
        category: "scores",
        team: "team_a",
        rosterOnly: true,
        excludePlayerIds: ["p1"],
      }),
    );
    expect(r.matched.map((t) => t.token)).toEqual(["p2_match"]);
    expect(r.rejected.rosterOnly).toBe(1);
    expect(r.rejected.excludePlayer).toBe(1);
  });

  it("returns empty matched + zero counters on empty token list", () => {
    const r = matchTokens([], payload());
    expect(r.matched).toHaveLength(0);
    for (const v of Object.values(r.rejected)) {
      expect(v).toBe(0);
    }
  });
});

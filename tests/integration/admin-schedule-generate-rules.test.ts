// /api/admin-schedule-generate save_rules, with and without the GameSlate
// engine's rules.
//
// The one thing that must stay true: a league that is not on the GameSlate
// engine never sends the `gameslate` key, and its rules document is written
// exactly as it was before that key existed. The second thing: whatever a
// browser posts under that key is bounded by the same normaliser the screen
// uses, and `game_minutes` lands where the conflict gate already reads it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, Record<string, unknown>>();
const state = { decoded: null as Record<string, unknown> | null };

function docRef(path: string) {
  return {
    id: path.split("/").pop()!,
    path,
    async get() {
      const d = store.get(path);
      return { exists: d !== undefined, data: () => d };
    },
    async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
      store.set(path, opts?.merge ? { ...(store.get(path) ?? {}), ...data } : { ...data });
    },
  };
}

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => {
      if (!state.decoded) throw new Error("no token");
      return state.decoded;
    }),
  }),
  getAdminDb: () => ({ doc: docRef }),
}));

const { POST } = await import("@/app/api/admin-schedule-generate/route");

const L = "etbl";
const ADMIN = { uid: "public-admin:etbl", leagues: { etbl: "admin" } };
const RULES = `leagues/${L}/site_config/schedule_rules`;

function req(body: Record<string, unknown>): Request {
  return new Request("http://test/api/admin-schedule-generate", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer fake" },
    body: JSON.stringify({ leagueId: L, action: "save_rules", ...body }),
  });
}

beforeEach(() => {
  store.clear();
  state.decoded = ADMIN;
});
afterEach(() => vi.clearAllMocks());

describe("save_rules without the GameSlate key (every other league)", () => {
  it("writes the document exactly as before: no gameslate, no game_minutes", async () => {
    const res = await POST(
      req({ blockedPairs: [["t_a", "t_b"]], teamSettings: {}, gamesPerTeam: 8 }),
    );
    expect(res.status).toBe(200);
    const doc = store.get(RULES)!;
    expect(Object.keys(doc).sort()).toEqual(
      ["blocked_pairs", "games_per_team", "team_settings", "updated_at", "updated_by"],
    );
    expect(doc.blocked_pairs).toEqual([["t_a", "t_b"]]);
    expect(doc.games_per_team).toBe(8);
  });

  it("leaves a game_minutes another tool set alone", async () => {
    store.set(RULES, { game_minutes: 120 });
    await POST(req({ blockedPairs: [], teamSettings: {}, gamesPerTeam: 0 }));
    expect(store.get(RULES)!.game_minutes).toBe(120);
  });
});

describe("save_rules with the GameSlate key (a league on that engine)", () => {
  it("stores the normalised rules and mirrors game_minutes for the conflict gate", async () => {
    const res = await POST(
      req({
        blockedPairs: [],
        teamSettings: {},
        gamesPerTeam: 0,
        gameslate: {
          cycles: 1,
          gameMinutes: 75,
          maxPerTeamPerDay: 1,
          doubleheaders: "avoid",
          linkedPairs: [["t_a", "t_c"]],
          seed: 42, // not a rule; dropped
        },
      }),
    );
    expect(res.status).toBe(200);
    const doc = store.get(RULES)!;
    expect(doc.game_minutes).toBe(75);
    expect(doc.gameslate).toEqual({
      cycles: 1,
      gameMinutes: 75,
      maxPerTeamPerDay: 1,
      doubleheaders: "avoid",
      minGapMinutes: 0,
      maxGapMinutes: 0,
      minDaysRest: 0,
      slotPreference: "balanced",
      homeFieldRule: "prefer",
      noRematchWeeks: 0,
      maxConsecutive: 0,
      pairAlternate: false,
      linkedPairs: [["t_a", "t_c"]],
    });
  });

  it("bounds what the browser sent", async () => {
    await POST(
      req({
        blockedPairs: [],
        teamSettings: {},
        gamesPerTeam: 0,
        gameslate: {
          gameMinutes: 100000,
          maxPerTeamPerDay: 9,
          slotPreference: "whenever",
          linkedPairs: [["t_a", "not a team id"], ["t_a", "t_b"]],
        },
      }),
    );
    const gs = store.get(RULES)!.gameslate as Record<string, unknown>;
    expect(gs.gameMinutes).toBe(300);
    expect(gs.maxPerTeamPerDay).toBe(4);
    expect(gs.slotPreference).toBe("balanced");
    expect(gs.linkedPairs).toEqual([["t_a", "t_b"]]);
    expect(store.get(RULES)!.game_minutes).toBe(300);
  });

  it("a non-object under the key is ignored, not stored", async () => {
    await POST(req({ blockedPairs: [], teamSettings: {}, gamesPerTeam: 0, gameslate: "yes" }));
    expect(store.get(RULES)!).not.toHaveProperty("gameslate");
  });

  it("still refuses anyone without the schedule scope", async () => {
    state.decoded = {
      uid: "public-admin:etbl:mineola",
      leagues: { etbl: "admin:mineola" },
      admin_role: "mineola",
      admin_scopes: ["scores", "volunteers"],
      admin_town: "Mineola",
    };
    const res = await POST(
      req({ blockedPairs: [], teamSettings: {}, gamesPerTeam: 0, gameslate: { cycles: 1 } }),
    );
    expect(res.status).toBe(403);
    expect(store.has(RULES)).toBe(false);
  });
});

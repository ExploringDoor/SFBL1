// Tests for lib/audit-tenant.ts → auditTenant.
//
// Covers each of the 6 dimensions ported from DVSL's data-integrity
// audit (DVSL §6 from the peer review). Each `describe` block
// targets one dimension + verifies it catches the bug class it's
// designed to catch and doesn't false-positive on clean data.

import { describe, expect, it } from "vitest";
import { auditTenant, formatAuditReport, type AuditDb } from "@/lib/audit-tenant";

// Tiny in-memory mock that satisfies the AuditDb interface.
function makeDb(
  data: Record<string, Array<{ id: string; data: Record<string, unknown> }>>,
): AuditDb {
  return {
    collection: (path: string) => ({
      get: async () => {
        const docs = data[path] ?? [];
        return {
          docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
        };
      },
    }),
    doc: () => ({
      get: async () => ({ exists: false, data: () => undefined }),
    }),
  };
}

const baseData = {
  "leagues/sfbl/teams": [
    { id: "team_a", data: { name: "Yankees" } },
    { id: "team_b", data: { name: "Red Sox" } },
  ],
  "leagues/sfbl/players": [
    { id: "p1", data: { name: "Aaron Judge", team_id: "team_a" } },
    { id: "p2", data: { name: "Mookie Betts", team_id: "team_b" } },
  ],
  "leagues/sfbl/games": [
    {
      id: "g1",
      data: {
        date: "2026-05-10",
        away_team_id: "team_a",
        home_team_id: "team_b",
        status: "scheduled",
      },
    },
  ],
  "leagues/sfbl/box_scores": [],
  "leagues/sfbl/box_score_submissions": [],
};

describe("auditTenant — clean data", () => {
  it("returns no issues on a fresh, valid tenant", async () => {
    const result = await auditTenant(makeDb(baseData), "sfbl");
    expect(result.issues).toEqual([]);
    expect(result.checked.teams).toBe(2);
    expect(result.checked.players).toBe(2);
    expect(result.checked.games).toBe(1);
  });

  it("formatAuditReport shows the success path", async () => {
    const result = await auditTenant(makeDb(baseData), "sfbl");
    const report = formatAuditReport(result);
    expect(report).toContain("✅ No issues found");
    expect(report).toContain("Tenant Audit");
  });
});

// ── Dimension 1: score parity ────────────────────────────────────

describe("auditTenant — score parity (final games)", () => {
  it("flags final game with no /box_scores doc", async () => {
    const data = {
      ...baseData,
      "leagues/sfbl/games": [
        {
          id: "g1",
          data: {
            date: "2026-05-10",
            away_team_id: "team_a",
            home_team_id: "team_b",
            status: "final",
            away_score: 7,
            home_score: 5,
          },
        },
      ],
    };
    const result = await auditTenant(makeDb(data), "sfbl");
    const issues = result.issues.filter((i) => i.dimension === "score_parity");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("final but has no /box_scores");
  });

  it("flags game/box_score score divergence", async () => {
    const data = {
      ...baseData,
      "leagues/sfbl/games": [
        {
          id: "g1",
          data: {
            date: "2026-05-10",
            away_team_id: "team_a",
            home_team_id: "team_b",
            status: "final",
            away_score: 7,
            home_score: 5,
          },
        },
      ],
      "leagues/sfbl/box_scores": [
        {
          id: "g1",
          data: { away_score: 7, home_score: 99 }, // home diverges
        },
      ],
    };
    const result = await auditTenant(makeDb(data), "sfbl");
    const issues = result.issues.filter((i) => i.dimension === "score_parity");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/home_score diverges/);
  });

  it("does NOT flag scheduled games (only finals are score-parity-checked)", async () => {
    // Default fixture has a scheduled game — should produce 0 score_parity issues.
    const result = await auditTenant(makeDb(baseData), "sfbl");
    expect(result.issues.filter((i) => i.dimension === "score_parity")).toEqual([]);
  });
});

// ── Dimension 2: schedule fields ─────────────────────────────────

describe("auditTenant — schedule fields", () => {
  it("flags missing date as warning", async () => {
    const data = {
      ...baseData,
      "leagues/sfbl/games": [
        {
          id: "g1",
          data: {
            away_team_id: "team_a",
            home_team_id: "team_b",
            status: "scheduled",
          },
        },
      ],
    };
    const result = await auditTenant(makeDb(data), "sfbl");
    const issues = result.issues.filter(
      (i) => i.dimension === "schedule_fields",
    );
    expect(issues.find((i) => i.message.includes("missing `date`"))).toBeDefined();
  });

  it("flags missing team_id as error", async () => {
    const data = {
      ...baseData,
      "leagues/sfbl/games": [
        {
          id: "g1",
          data: {
            date: "2026-05-10",
            home_team_id: "team_b",
            status: "scheduled",
          },
        },
      ],
    };
    const result = await auditTenant(makeDb(data), "sfbl");
    const issues = result.issues.filter(
      (i) =>
        i.dimension === "schedule_fields" &&
        i.message.includes("away_team_id"),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe("error");
  });

  it("flags team playing itself", async () => {
    const data = {
      ...baseData,
      "leagues/sfbl/games": [
        {
          id: "g1",
          data: {
            date: "2026-05-10",
            away_team_id: "team_a",
            home_team_id: "team_a",
            status: "scheduled",
          },
        },
      ],
    };
    const result = await auditTenant(makeDb(data), "sfbl");
    expect(
      result.issues.some((i) => i.message.includes("both home and away")),
    ).toBe(true);
  });

  it("flags team_id pointing to nonexistent team", async () => {
    const data = {
      ...baseData,
      "leagues/sfbl/games": [
        {
          id: "g1",
          data: {
            date: "2026-05-10",
            away_team_id: "team_ghost",
            home_team_id: "team_b",
            status: "scheduled",
          },
        },
      ],
    };
    const result = await auditTenant(makeDb(data), "sfbl");
    expect(
      result.issues.some((i) =>
        i.message.includes('"team_ghost" is not in /teams'),
      ),
    ).toBe(true);
  });
});

// ── Dimension 3: orphan player refs in box-score lineups ─────────

describe("auditTenant — orphan player refs", () => {
  it("flags a lineup entry with a player_id not in /players", async () => {
    const data = {
      ...baseData,
      "leagues/sfbl/box_scores": [
        {
          id: "g1",
          data: {
            away_lineup: [
              { player_id: "p1", ab: 4 }, // valid
              { player_id: "p_ghost", ab: 3 }, // orphan
            ],
            home_lineup: [],
          },
        },
      ],
    };
    const result = await auditTenant(makeDb(data), "sfbl");
    const issues = result.issues.filter(
      (i) => i.dimension === "orphan_player_ref",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('"p_ghost"');
  });

  it("flags orphan in pitchers lineup too", async () => {
    const data = {
      ...baseData,
      "leagues/sfbl/box_scores": [
        {
          id: "g1",
          data: {
            home_pitchers: [{ player_id: "p_ghost_pitcher", ip_outs: 21 }],
          },
        },
      ],
    };
    const result = await auditTenant(makeDb(data), "sfbl");
    expect(
      result.issues.some((i) =>
        i.message.includes("home_pitchers references"),
      ),
    ).toBe(true);
  });

  it("does not flag entries with empty/missing player_id", async () => {
    const data = {
      ...baseData,
      "leagues/sfbl/box_scores": [
        {
          id: "g1",
          data: {
            away_lineup: [
              { player_id: "" }, // skipped (empty)
              {}, // skipped (no player_id)
            ],
          },
        },
      ],
    };
    const result = await auditTenant(makeDb(data), "sfbl");
    expect(
      result.issues.filter((i) => i.dimension === "orphan_player_ref"),
    ).toEqual([]);
  });
});

// ── Dimension 4: player_team_ref ─────────────────────────────────

describe("auditTenant — player_team_ref", () => {
  it("flags player with team_id not in /teams", async () => {
    const data = {
      ...baseData,
      "leagues/sfbl/players": [
        { id: "p1", data: { name: "p1", team_id: "team_a" } },
        { id: "p_orphan", data: { name: "Orphan", team_id: "team_ghost" } },
      ],
    };
    const result = await auditTenant(makeDb(data), "sfbl");
    const issues = result.issues.filter(
      (i) => i.dimension === "player_team_ref",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.ref).toContain("p_orphan");
  });

  it("flags player with missing team_id", async () => {
    const data = {
      ...baseData,
      "leagues/sfbl/players": [
        { id: "p1", data: { name: "p1" } }, // no team_id
      ],
    };
    const result = await auditTenant(makeDb(data), "sfbl");
    const issues = result.issues.filter(
      (i) => i.dimension === "player_team_ref",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("missing or non-string team_id");
  });
});

// ── Dimension 5: duplicate cleanName ─────────────────────────────

describe("auditTenant — duplicate cleanName collisions", () => {
  it("flags two players on the same team with same cleaned name (NBSP-split scenario)", async () => {
    const data = {
      ...baseData,
      "leagues/sfbl/players": [
        // NBSP-split version
        { id: "p1", data: { name: "John Smith", team_id: "team_a" } },
        // Regular-space version (from a later captain edit)
        { id: "p2", data: { name: "John Smith", team_id: "team_a" } },
      ],
    };
    const result = await auditTenant(makeDb(data), "sfbl");
    const issues = result.issues.filter(
      (i) => i.dimension === "duplicate_player_name",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.level).toBe("warning");
    expect(issues[0]!.message).toContain('team "team_a"');
    expect(issues[0]!.ref).toContain("p1");
    expect(issues[0]!.ref).toContain("p2");
  });

  it("does NOT flag same name on DIFFERENT teams (legitimate)", async () => {
    const data = {
      ...baseData,
      "leagues/sfbl/players": [
        { id: "p1", data: { name: "John Smith", team_id: "team_a" } },
        { id: "p2", data: { name: "John Smith", team_id: "team_b" } },
      ],
    };
    const result = await auditTenant(makeDb(data), "sfbl");
    expect(
      result.issues.filter((i) => i.dimension === "duplicate_player_name"),
    ).toEqual([]);
  });

  it("is case-insensitive (catches 'john smith' vs 'John Smith')", async () => {
    const data = {
      ...baseData,
      "leagues/sfbl/players": [
        { id: "p1", data: { name: "John Smith", team_id: "team_a" } },
        { id: "p2", data: { name: "john smith", team_id: "team_a" } },
      ],
    };
    const result = await auditTenant(makeDb(data), "sfbl");
    expect(
      result.issues.filter((i) => i.dimension === "duplicate_player_name"),
    ).toHaveLength(1);
  });
});

// ── Dimension 6: orphan submissions ──────────────────────────────

describe("auditTenant — orphan submissions", () => {
  it("flags a submission whose game_id doesn't exist in /games", async () => {
    const data = {
      ...baseData,
      "leagues/sfbl/box_score_submissions": [
        {
          id: "g_ghost_team_a",
          data: { game_id: "g_ghost", team_id: "team_a" },
        },
      ],
    };
    const result = await auditTenant(makeDb(data), "sfbl");
    const issues = result.issues.filter(
      (i) => i.dimension === "orphan_submission",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('"g_ghost"');
  });
});

// ── Report formatter ─────────────────────────────────────────────

describe("formatAuditReport — output format", () => {
  it("includes a tag for each level + dimension counts", async () => {
    const data = {
      ...baseData,
      "leagues/sfbl/players": [
        { id: "p_orphan", data: { name: "Orphan", team_id: "team_ghost" } },
      ],
    };
    const result = await auditTenant(makeDb(data), "sfbl");
    const report = formatAuditReport(result);
    expect(report).toContain("❌");
    expect(report).toContain("player_team_ref");
    expect(report).toMatch(/1 issue/);
  });
});

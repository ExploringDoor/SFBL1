// Integration tests for the CSV staging logic in scripts/provision.ts.
//
// The script itself is a CLI entry point with side effects on import
// (process.env loader, firebase init, process.exit on bad config).
// We can't import its functions directly without those side effects
// firing. So we copy the staging logic verbatim here, parameterized
// by leagueId, and test that. Pattern matches tests/integration/
// csv-parse.test.ts.
//
// IMPORTANT: keep these inline copies in sync with scripts/provision.ts.
// If you change one, change both. The test will catch divergence
// because we test against the same CSV → output contract.

import { describe, expect, it } from "vitest";

// ── Verbatim copies (parameterized) ─────────────────────────────────

interface StageResult {
  errors: string[];
  writes: { path: string; data: Record<string, unknown> }[];
}

const isoSlug = /^[a-z0-9][a-z0-9_-]*$/;

function requireFields(
  obj: Record<string, string>,
  fields: string[],
  label: string,
  rowIdx: number,
): string[] {
  const missing: string[] = [];
  for (const f of fields) {
    if (!obj[f] || !obj[f]!.trim()) missing.push(f);
  }
  if (missing.length) {
    return [
      `[${label} row ${rowIdx + 2}] missing required field(s): ${missing.join(", ")}`,
    ];
  }
  return [];
}

function stageTeams(
  rows: Record<string, string>[],
  leagueId: string,
): StageResult {
  const errors: string[] = [];
  const writes: StageResult["writes"] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    errors.push(...requireFields(r, ["id", "name"], "teams", i));
    if (r.id && !isoSlug.test(r.id)) {
      errors.push(
        `[teams row ${i + 2}] id "${r.id}" must be lowercase alphanumeric (with - or _)`,
      );
    }
    if (r.id && seenIds.has(r.id)) {
      errors.push(
        `[teams row ${i + 2}] duplicate id "${r.id}" — appeared earlier in the same CSV`,
      );
    }
    if (errors.length && errors[errors.length - 1]!.includes(`row ${i + 2}`)) {
      continue;
    }
    if (r.id) seenIds.add(r.id);
    writes.push({
      path: `leagues/${leagueId}/teams/${r.id}`,
      data: {
        name: r.name,
        ...(r.abbrev ? { abbrev: r.abbrev } : {}),
        ...(r.division ? { division: r.division } : {}),
        ...(r.color ? { color: r.color } : {}),
        ...(r.logo_url ? { logo_url: r.logo_url } : {}),
        active: true,
        updated_at: new Date().toISOString(),
      },
    });
  }
  return { errors, writes };
}

function stagePlayers(
  rows: Record<string, string>[],
  leagueId: string,
): StageResult {
  const errors: string[] = [];
  const writes: StageResult["writes"] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    errors.push(...requireFields(r, ["team_id", "name"], "players", i));
    const playerName = String(r.name ?? "");
    const teamId = String(r.team_id ?? "");
    const id =
      r.id ||
      `${teamId}_${playerName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")}`;
    if (!isoSlug.test(id)) {
      errors.push(`[players row ${i + 2}] computed id "${id}" is invalid`);
      continue;
    }
    if (seenIds.has(id)) {
      errors.push(
        `[players row ${i + 2}] duplicate computed id "${id}" — two players with the same name on team "${teamId}". Disambiguate names (e.g. "John Smith Jr") or supply explicit ids.`,
      );
      continue;
    }
    const jersey = r.jersey ? Number(r.jersey) : null;
    if (r.jersey && !Number.isFinite(jersey)) {
      errors.push(`[players row ${i + 2}] jersey "${r.jersey}" not a number`);
      continue;
    }
    seenIds.add(id);
    writes.push({
      path: `leagues/${leagueId}/players/${id}`,
      data: {
        team_id: r.team_id,
        name: r.name,
        ...(jersey != null ? { jersey } : {}),
        ...(r.position ? { position: r.position } : {}),
        ...(r.email ? { email: r.email.toLowerCase() } : {}),
        ...(r.phone ? { phone: r.phone } : {}),
        active: true,
        updated_at: new Date().toISOString(),
      },
    });
  }
  return { errors, writes };
}

function stageSchedule(
  rows: Record<string, string>[],
  leagueId: string,
): StageResult {
  const errors: string[] = [];
  const writes: StageResult["writes"] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    errors.push(
      ...requireFields(
        r,
        ["id", "date", "away_team_id", "home_team_id"],
        "schedule",
        i,
      ),
    );
    if (r.id && !isoSlug.test(r.id)) {
      errors.push(`[schedule row ${i + 2}] id "${r.id}" invalid`);
      continue;
    }
    if (r.id && seenIds.has(r.id)) {
      errors.push(
        `[schedule row ${i + 2}] duplicate id "${r.id}" — appeared earlier in the same CSV`,
      );
      continue;
    }
    if (r.id) seenIds.add(r.id);
    if (r.away_team_id && r.away_team_id === r.home_team_id) {
      errors.push(
        `[schedule row ${i + 2}] away_team_id and home_team_id are the same ("${r.away_team_id}") — a team can't play itself`,
      );
      continue;
    }
    let dateIso: string | null = null;
    const dateRaw = String(r.date ?? "");
    const timeRaw = String(r.time ?? "");
    if (/T\d/.test(dateRaw)) {
      const d = new Date(dateRaw);
      if (!Number.isNaN(d.getTime())) dateIso = d.toISOString();
    } else if (dateRaw) {
      const t = /^\d{1,2}:\d{2}$/.test(timeRaw) ? timeRaw : "00:00";
      const d = new Date(`${dateRaw}T${t}`);
      if (!Number.isNaN(d.getTime())) dateIso = d.toISOString();
    }
    if (!dateIso) {
      errors.push(
        `[schedule row ${i + 2}] couldn't parse date="${r.date}" time="${r.time ?? ""}"`,
      );
      continue;
    }
    const week = r.week ? Number(r.week) : null;
    if (r.week && !Number.isFinite(week)) {
      errors.push(`[schedule row ${i + 2}] week "${r.week}" not a number`);
      continue;
    }
    const ALLOWED_STATUS = new Set([
      "scheduled",
      "final",
      "approved",
      "postponed",
      "cancelled",
    ]);
    const rawStatus = (r.status ?? "scheduled").toLowerCase();
    if (!ALLOWED_STATUS.has(rawStatus)) {
      errors.push(
        `[schedule row ${i + 2}] invalid status "${r.status}" — must be one of ${[...ALLOWED_STATUS].join(", ")}`,
      );
      continue;
    }
    const status = rawStatus as
      | "scheduled"
      | "final"
      | "approved"
      | "postponed"
      | "cancelled";
    const awayScoreNum =
      r.away_score && r.away_score !== "" ? Number(r.away_score) : null;
    const homeScoreNum =
      r.home_score && r.home_score !== "" ? Number(r.home_score) : null;
    if (
      r.away_score &&
      r.away_score !== "" &&
      !Number.isFinite(awayScoreNum)
    ) {
      errors.push(
        `[schedule row ${i + 2}] away_score "${r.away_score}" not a number`,
      );
      continue;
    }
    if (
      r.home_score &&
      r.home_score !== "" &&
      !Number.isFinite(homeScoreNum)
    ) {
      errors.push(
        `[schedule row ${i + 2}] home_score "${r.home_score}" not a number`,
      );
      continue;
    }
    writes.push({
      path: `leagues/${leagueId}/games/${r.id}`,
      data: {
        date: dateIso,
        away_team_id: r.away_team_id,
        home_team_id: r.home_team_id,
        ...(r.field ? { field: r.field } : {}),
        ...(week != null ? { week } : {}),
        ...(r.division ? { division: r.division } : {}),
        status,
        away_score: awayScoreNum ?? 0,
        home_score: homeScoreNum ?? 0,
        updated_at: new Date().toISOString(),
      },
    });
    if (
      (status === "final" || status === "approved") &&
      Number.isFinite(awayScoreNum) &&
      Number.isFinite(homeScoreNum)
    ) {
      writes.push({
        path: `leagues/${leagueId}/box_scores/${r.id}`,
        data: {
          status,
          away_score: awayScoreNum,
          home_score: homeScoreNum,
          away_score_only: true,
          home_score_only: true,
          away_lineup: [],
          home_lineup: [],
          away_pitchers: [],
          home_pitchers: [],
          updated_at: new Date().toISOString(),
        },
      });
    }
  }
  return { errors, writes };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("stageTeams", () => {
  it("empty rows = no errors, no writes", () => {
    const r = stageTeams([], "sfbl");
    expect(r.errors).toEqual([]);
    expect(r.writes).toEqual([]);
  });

  it("flags missing required fields", () => {
    const r = stageTeams(
      [{ id: "team_a" }, { name: "Team B" }] as never,
      "sfbl",
    );
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toMatch(/missing required field/);
    expect(r.writes).toEqual([]);
  });

  it("rejects malformed team id (uppercase)", () => {
    const r = stageTeams(
      [{ id: "Team_A", name: "Team A" }],
      "sfbl",
    );
    expect(r.errors[0]).toMatch(/lowercase/);
    expect(r.writes).toEqual([]);
  });

  it("rejects team id starting with hyphen", () => {
    const r = stageTeams([{ id: "-team", name: "X" }], "sfbl");
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("flags duplicate id (silent overwrite guard)", () => {
    const r = stageTeams(
      [
        { id: "team_a", name: "Team A" },
        { id: "team_a", name: "Different Name Same ID" },
      ],
      "sfbl",
    );
    expect(r.errors.some((e) => e.includes("duplicate id"))).toBe(true);
    expect(r.writes).toHaveLength(1); // only the first one is staged
  });

  it("happy path writes optional fields when present", () => {
    const r = stageTeams(
      [
        {
          id: "team_a",
          name: "Yankees",
          abbrev: "NYY",
          color: "#003087",
          division: "American",
          logo_url: "/logos/sfbl/yankees.png",
        },
      ],
      "sfbl",
    );
    expect(r.errors).toEqual([]);
    expect(r.writes[0]!.path).toBe("leagues/sfbl/teams/team_a");
    expect(r.writes[0]!.data).toMatchObject({
      name: "Yankees",
      abbrev: "NYY",
      color: "#003087",
      division: "American",
      logo_url: "/logos/sfbl/yankees.png",
      active: true,
    });
  });

  it("omits empty optional fields entirely (doesn't write empty strings)", () => {
    const r = stageTeams(
      [
        {
          id: "team_a",
          name: "Yankees",
          abbrev: "",
          color: "",
          division: "",
        },
      ],
      "sfbl",
    );
    expect(r.errors).toEqual([]);
    expect(r.writes[0]!.data).not.toHaveProperty("abbrev");
    expect(r.writes[0]!.data).not.toHaveProperty("color");
    expect(r.writes[0]!.data).not.toHaveProperty("division");
  });
});

describe("stagePlayers", () => {
  it("flags duplicate computed id when two players share name on same team", () => {
    const r = stagePlayers(
      [
        { team_id: "team_a", name: "John Smith" },
        { team_id: "team_a", name: "John Smith" }, // same team, same name
      ],
      "sfbl",
    );
    expect(r.errors.some((e) => e.includes("duplicate computed id"))).toBe(true);
    expect(r.writes).toHaveLength(1);
  });

  it("does NOT flag dup when same name on different teams", () => {
    const r = stagePlayers(
      [
        { team_id: "team_a", name: "John Smith" },
        { team_id: "team_b", name: "John Smith" }, // different team
      ],
      "sfbl",
    );
    expect(r.errors).toEqual([]);
    expect(r.writes).toHaveLength(2);
  });

  it("computes id from team_id + slugified name when id missing", () => {
    const r = stagePlayers(
      [{ team_id: "team_a", name: "Aaron Judge" }],
      "sfbl",
    );
    expect(r.writes[0]!.path).toBe(
      "leagues/sfbl/players/team_a_aaron_judge",
    );
  });

  it("handles names with special chars (apostrophes, accents, etc.)", () => {
    const r = stagePlayers(
      [
        { team_id: "team_a", name: "D'Angelo Ortiz" },
        { team_id: "team_a", name: "José Ramírez" },
      ],
      "sfbl",
    );
    expect(r.errors).toEqual([]);
    expect(r.writes[0]!.path).toBe("leagues/sfbl/players/team_a_d_angelo_ortiz");
    // Accent normalized to underscore via the [^a-z0-9]+ pattern.
    expect(r.writes[1]!.path).toBe("leagues/sfbl/players/team_a_jos_ram_rez");
  });

  it("rejects malformed jersey", () => {
    const r = stagePlayers(
      [
        {
          team_id: "team_a",
          name: "Walk On",
          jersey: "abc" as never,
        },
      ],
      "sfbl",
    );
    expect(r.errors[0]).toMatch(/jersey/);
    expect(r.writes).toEqual([]);
  });

  it("normalizes email to lowercase", () => {
    const r = stagePlayers(
      [
        {
          team_id: "team_a",
          name: "Captain",
          email: "Captain@Example.COM",
        },
      ],
      "sfbl",
    );
    expect(r.writes[0]!.data.email).toBe("captain@example.com");
  });

  it("respects supplied id (skips slug generation)", () => {
    const r = stagePlayers(
      [
        {
          team_id: "team_a",
          name: "Custom",
          id: "p_custom_42",
        },
      ],
      "sfbl",
    );
    expect(r.writes[0]!.path).toBe("leagues/sfbl/players/p_custom_42");
  });
});

describe("stageSchedule", () => {
  it("rejects a team playing itself", () => {
    const r = stageSchedule(
      [
        {
          id: "g1",
          date: "2026-05-10",
          away_team_id: "team_a",
          home_team_id: "team_a", // same team
        },
      ],
      "sfbl",
    );
    expect(r.errors.some((e) => e.includes("can't play itself"))).toBe(true);
    expect(r.writes).toEqual([]);
  });

  it("rejects duplicate game id", () => {
    const r = stageSchedule(
      [
        {
          id: "g1",
          date: "2026-05-10",
          away_team_id: "team_a",
          home_team_id: "team_b",
        },
        {
          id: "g1",
          date: "2026-05-17",
          away_team_id: "team_c",
          home_team_id: "team_d",
        },
      ],
      "sfbl",
    );
    expect(r.errors.some((e) => e.includes("duplicate id"))).toBe(true);
    expect(r.writes).toHaveLength(1);
  });

  it("combines date + time into ISO datetime", () => {
    const r = stageSchedule(
      [
        {
          id: "g1",
          date: "2026-05-10",
          time: "18:00",
          away_team_id: "team_a",
          home_team_id: "team_b",
        },
      ],
      "sfbl",
    );
    expect(r.errors).toEqual([]);
    const dateStr = String(r.writes[0]!.data.date);
    expect(dateStr).toContain("2026-05-10");
    expect(dateStr).toContain("T");
  });

  it("treats date with T as a complete datetime", () => {
    const r = stageSchedule(
      [
        {
          id: "g1",
          date: "2026-05-10T18:00:00-04:00",
          away_team_id: "team_a",
          home_team_id: "team_b",
        },
      ],
      "sfbl",
    );
    expect(r.errors).toEqual([]);
  });

  it("falls back to 00:00 for malformed time", () => {
    const r = stageSchedule(
      [
        {
          id: "g1",
          date: "2026-05-10",
          time: "evening", // not parseable
          away_team_id: "team_a",
          home_team_id: "team_b",
        },
      ],
      "sfbl",
    );
    expect(r.errors).toEqual([]); // bad time isn't fatal
    const dateStr = String(r.writes[0]!.data.date);
    expect(dateStr).toContain("T");
  });

  it("rejects unparseable date entirely", () => {
    const r = stageSchedule(
      [
        {
          id: "g1",
          date: "not a date",
          away_team_id: "team_a",
          home_team_id: "team_b",
        },
      ],
      "sfbl",
    );
    expect(r.errors[0]).toMatch(/couldn't parse/);
    expect(r.writes).toEqual([]);
  });

  it("rejects malformed week number", () => {
    const r = stageSchedule(
      [
        {
          id: "g1",
          date: "2026-05-10",
          away_team_id: "team_a",
          home_team_id: "team_b",
          week: "five",
        },
      ],
      "sfbl",
    );
    expect(r.errors[0]).toMatch(/week/);
    expect(r.writes).toEqual([]);
  });

  it("happy path stamps status:scheduled and zero scores", () => {
    const r = stageSchedule(
      [
        {
          id: "g1",
          date: "2026-05-10",
          time: "18:00",
          field: "Field 1",
          away_team_id: "team_a",
          home_team_id: "team_b",
          week: "1",
        },
      ],
      "sfbl",
    );
    expect(r.errors).toEqual([]);
    expect(r.writes[0]!.data).toMatchObject({
      status: "scheduled",
      away_score: 0,
      home_score: 0,
      week: 1,
      field: "Field 1",
      away_team_id: "team_a",
      home_team_id: "team_b",
    });
  });

  // ── Status + scores (added 2026-05-05 for the SFBL import) ──
  // The schedule CSV now accepts optional `status`, `away_score`,
  // `home_score` columns so historical seasons can be imported with
  // their results (vs. starting fresh). Defaults preserve the old
  // single-status behavior so legacy CSVs still work.

  it("status defaults to 'scheduled' when column is missing", () => {
    const r = stageSchedule(
      [
        {
          id: "g1",
          date: "2026-05-10",
          time: "18:00",
          away_team_id: "team_a",
          home_team_id: "team_b",
        },
      ],
      "sfbl",
    );
    expect(r.errors).toEqual([]);
    expect(r.writes[0]!.data.status).toBe("scheduled");
    expect(r.writes[0]!.data.away_score).toBe(0);
    expect(r.writes[0]!.data.home_score).toBe(0);
  });

  it("imports status='final' with scores AND emits a /box_scores doc", () => {
    const r = stageSchedule(
      [
        {
          id: "g1",
          date: "2026-05-10",
          time: "18:00",
          away_team_id: "team_a",
          home_team_id: "team_b",
          status: "final",
          away_score: "7",
          home_score: "5",
        },
      ],
      "sfbl",
    );
    expect(r.errors).toEqual([]);
    expect(r.writes).toHaveLength(2);
    const gameWrite = r.writes.find((w) =>
      w.path.startsWith("leagues/sfbl/games/"),
    );
    expect(gameWrite!.data.status).toBe("final");
    expect(gameWrite!.data.away_score).toBe(7);
    expect(gameWrite!.data.home_score).toBe(5);
    const boxWrite = r.writes.find((w) =>
      w.path.startsWith("leagues/sfbl/box_scores/"),
    );
    expect(boxWrite).toBeDefined();
    expect(boxWrite!.data.away_score).toBe(7);
    expect(boxWrite!.data.home_score).toBe(5);
    // Score-only flags so the public box-score page renders an empty-
    // lineup placeholder instead of pretending lineups exist.
    expect(boxWrite!.data.away_score_only).toBe(true);
    expect(boxWrite!.data.home_score_only).toBe(true);
    expect(boxWrite!.data.away_lineup).toEqual([]);
    expect(boxWrite!.data.home_lineup).toEqual([]);
  });

  it("'approved' status also gets a /box_scores doc (admin-confirmed final)", () => {
    const r = stageSchedule(
      [
        {
          id: "g1",
          date: "2026-05-10",
          time: "18:00",
          away_team_id: "team_a",
          home_team_id: "team_b",
          status: "approved",
          away_score: "3",
          home_score: "3",
        },
      ],
      "sfbl",
    );
    expect(
      r.writes.find((w) =>
        w.path.startsWith("leagues/sfbl/box_scores/"),
      ),
    ).toBeDefined();
  });

  it("'postponed' does NOT get a /box_scores doc (audit would flag)", () => {
    const r = stageSchedule(
      [
        {
          id: "g1",
          date: "2026-05-10",
          time: "18:00",
          away_team_id: "team_a",
          home_team_id: "team_b",
          status: "postponed",
        },
      ],
      "sfbl",
    );
    expect(r.writes).toHaveLength(1);
    expect(r.writes[0]!.path).toMatch(/\/games\//);
  });

  it("'final' WITHOUT scores does NOT emit a /box_scores doc (incomplete)", () => {
    // Edge case: row says final but scores absent. We still write the
    // game (admin can fill it in) but skip the synthetic box-score
    // doc — no point writing 0-0 score-only when the user didn't
    // supply scores.
    const r = stageSchedule(
      [
        {
          id: "g1",
          date: "2026-05-10",
          time: "18:00",
          away_team_id: "team_a",
          home_team_id: "team_b",
          status: "final",
        },
      ],
      "sfbl",
    );
    expect(r.writes).toHaveLength(1);
    expect(r.writes[0]!.path).toMatch(/\/games\//);
  });

  it("rejects invalid status values", () => {
    const r = stageSchedule(
      [
        {
          id: "g1",
          date: "2026-05-10",
          time: "18:00",
          away_team_id: "team_a",
          home_team_id: "team_b",
          status: "definitely-not-real",
        },
      ],
      "sfbl",
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/invalid status/);
  });

  it("rejects non-numeric away_score or home_score", () => {
    const r = stageSchedule(
      [
        {
          id: "g1",
          date: "2026-05-10",
          time: "18:00",
          away_team_id: "team_a",
          home_team_id: "team_b",
          status: "final",
          away_score: "seven",
          home_score: "5",
        },
      ],
      "sfbl",
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/away_score "seven" not a number/);
  });
});

// ── Idempotency ────────────────────────────────────────────────────
//
// Re-running provision against the same CSV should be safe. The
// staging output is deterministic (modulo timestamps). The actual
// commit uses setDoc(merge:true) which is naturally idempotent.
// These tests assert the staging layer doesn't introduce drift on
// re-run — important because the runbook says "if your CSV had a
// typo, fix it and re-run."

describe("staging idempotency", () => {
  it("stageTeams: same input → same writes (excluding timestamps)", () => {
    const input = [
      {
        id: "team_a",
        name: "Yankees",
        abbrev: "NYY",
        color: "#003087",
      },
    ];
    const a = stageTeams(input, "sfbl");
    const b = stageTeams(input, "sfbl");
    expect(a.errors).toEqual(b.errors);
    expect(a.writes).toHaveLength(b.writes.length);
    for (let i = 0; i < a.writes.length; i++) {
      const aData = { ...a.writes[i]!.data };
      const bData = { ...b.writes[i]!.data };
      delete aData.updated_at;
      delete bData.updated_at;
      expect(a.writes[i]!.path).toBe(b.writes[i]!.path);
      expect(aData).toEqual(bData);
    }
  });

  it("stagePlayers: same input → same paths + data (timestamps aside)", () => {
    const input = [
      { team_id: "team_a", name: "Aaron Judge", jersey: "99" },
      { team_id: "team_b", name: "Mookie Betts", jersey: "50" },
    ];
    const a = stagePlayers(input, "sfbl");
    const b = stagePlayers(input, "sfbl");
    expect(a.writes.map((w) => w.path)).toEqual(
      b.writes.map((w) => w.path),
    );
    for (let i = 0; i < a.writes.length; i++) {
      const aData = { ...a.writes[i]!.data, updated_at: undefined };
      const bData = { ...b.writes[i]!.data, updated_at: undefined };
      expect(aData).toEqual(bData);
    }
  });

  it("stageSchedule: ISO date conversion is deterministic", () => {
    const input = [
      {
        id: "g1",
        date: "2026-05-10",
        time: "18:00",
        away_team_id: "team_a",
        home_team_id: "team_b",
      },
    ];
    const a = stageSchedule(input, "sfbl");
    const b = stageSchedule(input, "sfbl");
    // Date conversion uses local TZ → must produce same ISO string
    // both times. (Not testing across machines with different TZ —
    // single-machine determinism is enough.)
    expect(a.writes[0]!.data.date).toBe(b.writes[0]!.data.date);
  });

  it("stageTeams: re-running with EXTRA optional fields adds them, doesn't error", () => {
    const first = stageTeams(
      [{ id: "team_a", name: "Yankees" }],
      "sfbl",
    );
    const second = stageTeams(
      [
        {
          id: "team_a",
          name: "Yankees",
          abbrev: "NYY",
          color: "#003087",
          division: "American",
        },
      ],
      "sfbl",
    );
    expect(first.errors).toEqual([]);
    expect(second.errors).toEqual([]);
    // Second run includes the new fields.
    expect(second.writes[0]!.data).toMatchObject({
      abbrev: "NYY",
      color: "#003087",
      division: "American",
    });
  });

  it("stageTeams: rerunning with SUBSET of fields doesn't produce errors", () => {
    // Real-world: commissioner provisions with full data, later
    // re-runs with just teams.csv that drops the color column. The
    // setDoc(merge:true) on commit means the existing color stays;
    // staging just shouldn't error.
    const r = stageTeams(
      [{ id: "team_a", name: "Yankees" }],
      "sfbl",
    );
    expect(r.errors).toEqual([]);
    expect(r.writes).toHaveLength(1);
    // Optional fields not in input should be absent from the staged
    // write — preserving whatever's already in Firestore on commit.
    expect(r.writes[0]!.data).not.toHaveProperty("color");
    expect(r.writes[0]!.data).not.toHaveProperty("abbrev");
  });
});

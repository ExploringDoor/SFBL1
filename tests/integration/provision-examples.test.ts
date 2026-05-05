// Round-trip the actual example CSVs in scripts/templates/ through
// the staging logic. Catches the case where someone edits the
// templates and breaks them — meaning T-24h dry-run for a real
// commissioner would explode.
//
// What we verify on each example file:
//   - Parses cleanly (no malformed CSV)
//   - Headers match the staging contract (id/name for teams, etc.)
//   - All required fields populated
//   - All cross-references resolve (player.team_id → existing team,
//     game.away_team_id + home_team_id → existing teams)
//   - No duplicate IDs
//   - No team plays itself
//
// Pattern matches csv-parse.test.ts: verbatim copies of the parser +
// stage helpers since scripts/provision.ts is a CLI module with
// import side effects. Keep in sync with the source of truth.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ── Verbatim copies (keep in sync with scripts/provision.ts) ──────

function parseCsv(rawInput: string): string[][] {
  const input =
    rawInput.charCodeAt(0) === 0xfeff ? rawInput.slice(1) : rawInput;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(cell);
      if (row[0] === "" && row.length === 1) {
        row = [];
        cell = "";
        i++;
        continue;
      }
      rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    cell += c;
    i++;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 0 && r.some((v) => v.trim() !== ""));
}

function csvToObjects(input: string): Record<string, string>[] {
  const rows = parseCsv(input);
  if (rows.length === 0) return [];
  const headers = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
}

// ── Helpers ───────────────────────────────────────────────────────

const TEMPLATES = join(process.cwd(), "scripts", "templates");

function readTemplate(name: string): string {
  return readFileSync(join(TEMPLATES, name), "utf-8");
}

function loadProvisionConfig(): {
  league: { slug: string };
  teams_csv: string;
  players_csv: string;
  schedule_csv: string;
  admins?: string[];
} {
  return JSON.parse(readTemplate("provision.example.json"));
}

// ── provision.example.json ────────────────────────────────────────

describe("provision.example.json", () => {
  const cfg = loadProvisionConfig();

  it("has the keys provision.ts expects", () => {
    expect(cfg.league).toBeDefined();
    expect(cfg.league.slug).toBeTruthy();
    expect(cfg.teams_csv).toBeTruthy();
    expect(cfg.players_csv).toBeTruthy();
    expect(cfg.schedule_csv).toBeTruthy();
  });

  it("references CSV files that exist on disk", () => {
    expect(() => readTemplate("teams.example.csv")).not.toThrow();
    expect(() => readTemplate("players.example.csv")).not.toThrow();
    expect(() => readTemplate("schedule.example.csv")).not.toThrow();
  });

  it("at least one admin email is present (otherwise no one can sign in to /admin)", () => {
    expect(cfg.admins).toBeDefined();
    expect(Array.isArray(cfg.admins)).toBe(true);
    expect(cfg.admins!.length).toBeGreaterThan(0);
    for (const email of cfg.admins!) {
      expect(email).toMatch(/.+@.+\..+/);
    }
  });
});

// ── teams.example.csv ─────────────────────────────────────────────

describe("teams.example.csv", () => {
  const csv = readTemplate("teams.example.csv");
  const rows = csvToObjects(csv);

  it("parses cleanly with at least 2 teams", () => {
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("every row has id + name", () => {
    for (const r of rows) {
      expect(r.id).toBeTruthy();
      expect(r.name).toBeTruthy();
    }
  });

  it("ids are valid slugs (lowercase alphanumeric + - _)", () => {
    const isoSlug = /^[a-z0-9][a-z0-9_-]*$/;
    for (const r of rows) {
      expect(r.id, `bad id: ${r.id}`).toMatch(isoSlug);
    }
  });

  it("no duplicate team ids", () => {
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── players.example.csv ───────────────────────────────────────────

describe("players.example.csv", () => {
  const csv = readTemplate("players.example.csv");
  const rows = csvToObjects(csv);

  it("parses cleanly with at least 1 player", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it("every row has team_id + name", () => {
    for (const r of rows) {
      expect(r.team_id).toBeTruthy();
      expect(r.name).toBeTruthy();
    }
  });

  it("every player team_id matches a team in teams.example.csv", () => {
    const teams = csvToObjects(readTemplate("teams.example.csv"));
    const teamIds = new Set(teams.map((t) => t.id));
    for (const p of rows) {
      expect(
        teamIds.has(p.team_id!),
        `player "${p.name}" has team_id "${p.team_id}" — not in teams.csv`,
      ).toBe(true);
    }
  });

  it("emails (when present) are well-formed", () => {
    for (const p of rows) {
      if (p.email && p.email.trim()) {
        expect(p.email, `bad email: ${p.email}`).toMatch(/.+@.+\..+/);
      }
    }
  });
});

// ── schedule.example.csv ──────────────────────────────────────────

describe("schedule.example.csv", () => {
  const csv = readTemplate("schedule.example.csv");
  const rows = csvToObjects(csv);

  it("parses cleanly with at least 1 game", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it("every game has id + date + away_team_id + home_team_id", () => {
    for (const r of rows) {
      expect(r.id).toBeTruthy();
      expect(r.date).toBeTruthy();
      expect(r.away_team_id).toBeTruthy();
      expect(r.home_team_id).toBeTruthy();
    }
  });

  it("date column is ISO 8601 (yyyy-mm-dd)", () => {
    for (const r of rows) {
      expect(
        r.date,
        `bad date "${r.date}" in game "${r.id}" — must be yyyy-mm-dd`,
      ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("time column (when present) is HH:MM 24-hour", () => {
    for (const r of rows) {
      if (r.time && r.time.trim()) {
        expect(
          r.time,
          `bad time "${r.time}" in game "${r.id}" — must be HH:MM`,
        ).toMatch(/^\d{2}:\d{2}$/);
      }
    }
  });

  it("no team plays itself", () => {
    for (const r of rows) {
      expect(r.away_team_id).not.toBe(r.home_team_id);
    }
  });

  it("every away_team_id + home_team_id matches a team in teams.example.csv", () => {
    const teams = csvToObjects(readTemplate("teams.example.csv"));
    const teamIds = new Set(teams.map((t) => t.id));
    for (const r of rows) {
      expect(
        teamIds.has(r.away_team_id!),
        `game "${r.id}" away_team_id "${r.away_team_id}" not in teams.csv`,
      ).toBe(true);
      expect(
        teamIds.has(r.home_team_id!),
        `game "${r.id}" home_team_id "${r.home_team_id}" not in teams.csv`,
      ).toBe(true);
    }
  });

  it("no duplicate game ids", () => {
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

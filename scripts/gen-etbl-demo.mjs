#!/usr/bin/env node
// Generate ETBL's PLACEHOLDER season: data/etbl/teams.csv, schedule.csv and
// fields.json.
//
// East Texas Basketball League: 96 teams, 6 divisions, 7 towns, one gym per
// town (two in Mineola), Saturday games. None of the real names are known yet
// — only Mineola is a real town — so everything here is an obvious stand-in
// that lets the league see a working site, and every row carries demo=true so
// the admin's "Remove sample season" can clear it in one click when the real
// CSVs arrive.
//
// Deterministic: a fixed seed, so re-running produces the same files and a
// re-provision is a no-op merge rather than a reshuffle. Change the constants
// at the top, re-run, re-provision.
//
//   node scripts/gen-etbl-demo.mjs

import fs from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "data", "etbl");
const SEED = 20260909;

// Six Saturdays straddling today (2026-09-09) so the site shows both results
// and upcoming games. Move to the real Nov–Feb window once the league says.
const SEASON_START = "2026-08-29";
const WEEKS = 6;
const FINAL_WEEKS = 2; // weeks 1–2 have scores, 3–6 are upcoming
const SLOTS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00"];

const TOWNS = [
  { name: "Mineola", slug: "mineola", abbr: "MIN", gyms: ["Mineola Community Gym", "Mineola Elementary Gym"] },
  { name: "Town B", slug: "town-b", abbr: "TWB", gyms: ["Town B Gym"] },
  { name: "Town C", slug: "town-c", abbr: "TWC", gyms: ["Town C Gym"] },
  { name: "Town D", slug: "town-d", abbr: "TWD", gyms: ["Town D Gym"] },
  { name: "Town E", slug: "town-e", abbr: "TWE", gyms: ["Town E Gym"] },
  { name: "Town F", slug: "town-f", abbr: "TWF", gyms: ["Town F Gym"] },
  { name: "Town G", slug: "town-g", abbr: "TWG", gyms: ["Town G Gym"] },
];

// 3 age groups × Boys/Girls = 6 divisions of 16. The age_group column turns
// on the platform's age-sectioned standings, team grid and score filters; the
// score band keeps results looking like the age group that produced them.
const DIVISIONS = [
  { code: "3B", age: "3rd Grade", div: "Boys", lo: 10, hi: 30 },
  { code: "3G", age: "3rd Grade", div: "Girls", lo: 10, hi: 28 },
  { code: "4B", age: "4th Grade", div: "Boys", lo: 14, hi: 36 },
  { code: "4G", age: "4th Grade", div: "Girls", lo: 12, hi: 34 },
  { code: "56B", age: "5th/6th Grade", div: "Boys", lo: 20, hi: 48 },
  { code: "56G", age: "5th/6th Grade", div: "Girls", lo: 18, hi: 44 },
];
const TEAMS_PER_DIVISION = 16;

const SUFFIXES = [
  { name: "Red", color: "#b91c1c" },
  { name: "Blue", color: "#1d4ed8" },
  { name: "White", color: "#6b7280" },
  { name: "Gold", color: "#ca8a04" },
];

// ── helpers ─────────────────────────────────────────────────────────────

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

function csv(rows) {
  return (
    rows
      .map((r) =>
        r
          .map((v) => {
            const s = String(v ?? "");
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(","),
      )
      .join("\n") + "\n"
  );
}

function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Circle-method round robin: the pairs for one round of n teams. */
function roundRobin(n, round) {
  const rest = Array.from({ length: n - 1 }, (_, i) => i + 1);
  const rot = round % (n - 1);
  const rotated = rest.slice(rest.length - rot).concat(rest.slice(0, rest.length - rot));
  const arr = [0, ...rotated];
  const pairs = [];
  for (let i = 0; i < n / 2; i++) {
    const a = arr[i];
    const b = arr[n - 1 - i];
    // Alternate who is home so every team gets both.
    pairs.push(round % 2 === 0 ? [a, b] : [b, a]);
  }
  return pairs;
}

// ── teams ───────────────────────────────────────────────────────────────

const teams = [];
for (const dv of DIVISIONS) {
  for (let k = 0; k < TEAMS_PER_DIVISION; k++) {
    const town = TOWNS[k % TOWNS.length];
    const suf = SUFFIXES[Math.floor(k / TOWNS.length)];
    teams.push({
      id: `t-${town.slug}-${dv.code.toLowerCase()}-${suf.name.toLowerCase()}`,
      name: `${town.name} ${dv.code} ${suf.name}`,
      abbrev: `${town.abbr}${dv.code}${suf.name[0]}`,
      division: dv.div,
      age_group: dv.age,
      organization: town.name,
      color: suf.color,
      town,
      dv,
    });
  }
}

// ── schedule ────────────────────────────────────────────────────────────

const ALL_GYMS = TOWNS.flatMap((t) => t.gyms);
const games = [];
for (let w = 1; w <= WEEKS; w++) {
  const date = addDays(SEASON_START, 7 * (w - 1));
  const isFinal = w <= FINAL_WEEKS;
  const slotUse = new Map(ALL_GYMS.map((g) => [g, new Set()]));
  // Interleave divisions so every gym hosts a mix of ages through the day.
  const dayGames = [];
  for (let i = 0; i < TEAMS_PER_DIVISION / 2; i++) {
    DIVISIONS.forEach((dv, d) => {
      const pool = teams.filter((t) => t.dv === dv);
      const [ai, hi] = roundRobin(TEAMS_PER_DIVISION, w - 1)[i];
      dayGames.push({ dv, n: i + 1, away: pool[ai], home: pool[hi], d });
    });
  }
  for (const g of dayGames) {
    // The home team's town gym when it has room, else the first gym that does.
    const prefer = [...g.home.town.gyms, ...ALL_GYMS];
    let placed = null;
    for (const gym of prefer) {
      const used = slotUse.get(gym);
      const slot = SLOTS.find((s) => !used.has(s));
      if (slot) {
        used.add(slot);
        placed = { gym, slot };
        break;
      }
    }
    if (!placed) throw new Error(`no gym slot left on ${date} — add gyms or slots`);
    let away_score = "";
    let home_score = "";
    if (isFinal) {
      away_score = randInt(g.dv.lo, g.dv.hi);
      home_score = randInt(g.dv.lo, g.dv.hi);
      if (home_score === away_score) home_score += 2; // no ties in basketball
    }
    games.push({
      id: `g-w${w}-${g.dv.code.toLowerCase()}-${g.n}`,
      date,
      time: placed.slot,
      field: placed.gym,
      away_team_id: g.away.id,
      home_team_id: g.home.id,
      week: w,
      division: `${g.dv.age} ${g.dv.div}`,
      status: isFinal ? "final" : "scheduled",
      away_score,
      home_score,
    });
  }
}

// ── gyms ────────────────────────────────────────────────────────────────

const fields = TOWNS.flatMap((t) =>
  t.gyms.map((name) => ({
    name,
    // Three comma parts so the fields directory reads the town out of it.
    address: `Address TBD, ${t.name}, TX`,
    notes: ["Placeholder gym — replace with the real venue and address."],
  })),
);

// ── write ───────────────────────────────────────────────────────────────

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  path.join(OUT, "teams.csv"),
  csv([
    ["id", "name", "abbrev", "division", "age_group", "organization", "color", "logo_url", "gamechanger_url", "demo"],
    ...teams.map((t) => [t.id, t.name, t.abbrev, t.division, t.age_group, t.organization, t.color, "", "", "true"]),
  ]),
);
fs.writeFileSync(
  path.join(OUT, "schedule.csv"),
  csv([
    ["id", "date", "time", "field", "away_team_id", "home_team_id", "week", "division", "status", "away_score", "home_score", "demo"],
    ...games.map((g) => [g.id, g.date, g.time, g.field, g.away_team_id, g.home_team_id, g.week, g.division, g.status, g.away_score, g.home_score, "true"]),
  ]),
);
fs.writeFileSync(path.join(OUT, "fields.json"), JSON.stringify(fields, null, 2) + "\n");

const finals = games.filter((g) => g.status === "final").length;
console.log(`[gen-etbl-demo] ${teams.length} teams, ${games.length} games (${finals} final, ${games.length - finals} upcoming), ${fields.length} gyms → ${OUT}`);

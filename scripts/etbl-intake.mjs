#!/usr/bin/env node
// Turn the league's plain spreadsheets into ETBL's provisioning files.
//
// A commissioner thinks in team names, towns and gyms, not in document ids.
// So the league fills in three simple sheets (data/etbl/intake/*.csv) and
// this script produces what scripts/provision.ts wants:
//
//   intake/teams.csv     town,division,team,color[,coach,coach_phone,coach_email]
//   intake/schedule.csv  date,time,gym,away_team,home_team,division[,away_score,home_score]
//   intake/gyms.csv      name,town,address,maps_url
//
//   → data/etbl/teams.csv, schedule.csv, fields.json
//   → data/etbl/provision.json: `fields` = the gym names, flags.demo_data = false
//
// Teams get an id from their name ("Mineola Yellowjackets" → t-mineola-yellowjackets),
// an abbreviation from their initials, and an age group read off the division
// ("3rd Grade Boys" → "3rd Grade"). Schedule rows are matched to teams by
// exact name (case- and space-insensitive); anything unmatched is an error,
// never a guess. Real data carries no demo flag.
//
//   node scripts/etbl-intake.mjs --dry-run      # validate + summarise, write nothing
//   node scripts/etbl-intake.mjs                # write the files
//
// Then: npm run provision -- --config data/etbl/provision.json (idempotent),
// npm run seed:fields -- --league etbl --file data/etbl/fields.json, and if
// the sample season is still up, Admin → Health → Remove sample season.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "data", "etbl");
const INTAKE = path.join(ROOT, "intake");
const DRY = process.argv.includes("--dry-run");

// ── tiny RFC-4180 reader / writer ───────────────────────────────────────

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return body.map((r, i) => {
    const o = { _row: i + 2 };
    keys.forEach((k, j) => (o[k] = (r[j] ?? "").trim()));
    return o;
  });
}

function toCsv(rows) {
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

function read(name) {
  const p = path.join(INTAKE, name);
  if (!fs.existsSync(p)) fail(`missing ${path.relative(process.cwd(), p)}`);
  return parseCsv(fs.readFileSync(p, "utf8"));
}

const errors = [];
const warnings = [];
function fail(msg) {
  console.error(`[etbl-intake] ${msg}`);
  process.exit(1);
}

// ── helpers ─────────────────────────────────────────────────────────────

const key = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const slug = (s) =>
  key(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function abbrevOf(name) {
  const words = String(name).split(/\s+/).filter(Boolean);
  const a =
    words.length === 1
      ? words[0].slice(0, 4)
      : words.map((w) => w[0]).join("").slice(0, 6);
  return a.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** "3rd Grade Boys" → "3rd Grade"; "5th/6th Grade Girls" → "5th/6th Grade";
 *  "10U" → "10U"; anything else → "" (no age sections). */
function ageGroupOf(division) {
  const d = String(division ?? "").trim();
  const grade = /^(\d+(?:st|nd|rd|th)(?:\s*\/\s*\d+(?:st|nd|rd|th))?\s+grade)\b/i.exec(d);
  if (grade) return grade[1].replace(/\s*\/\s*/, "/");
  const u = /^(\d{1,2}u)\b/i.exec(d);
  if (u) return u[1].toUpperCase();
  return "";
}

function toIsoDate(raw) {
  const s = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

function to24h(raw) {
  const s = String(raw ?? "").trim();
  let m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(s);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3].toLowerCase() === "pm") h += 12;
    return `${String(h).padStart(2, "0")}:${m[2]}`;
  }
  m = /^(\d{1,2})\s*(am|pm)$/i.exec(s);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[2].toLowerCase() === "pm") h += 12;
    return `${String(h).padStart(2, "0")}:00`;
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  return null;
}

// ── teams ───────────────────────────────────────────────────────────────

const teamRows = read("teams.csv");
const teams = [];
const byName = new Map();
const usedIds = new Set();
for (const r of teamRows) {
  const town = r.town;
  const division = r.division;
  const name = r.team;
  if (!town || !division || !name) {
    errors.push(`teams.csv row ${r._row}: town, division and team are all required`);
    continue;
  }
  if (byName.has(key(name))) {
    errors.push(`teams.csv row ${r._row}: duplicate team name "${name}"`);
    continue;
  }
  let id = `t-${slug(name)}`;
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
    errors.push(`teams.csv row ${r._row}: cannot make an id from "${name}"`);
    continue;
  }
  for (let n = 2; usedIds.has(id); n++) id = `t-${slug(name)}-${n}`;
  usedIds.add(id);
  const color = r.color && /^#[0-9a-fA-F]{3,8}$/.test(r.color) ? r.color : "";
  if (r.color && !color) warnings.push(`teams.csv row ${r._row}: color "${r.color}" is not a hex colour, ignored`);
  const coachEmail = (r.coach_email ?? "").trim().toLowerCase();
  if (coachEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(coachEmail)) {
    warnings.push(`teams.csv row ${r._row}: coach_email "${r.coach_email}" does not look like an email`);
  }
  const t = {
    id,
    name: name.replace(/\s+/g, " "),
    abbrev: abbrevOf(name),
    division: division.replace(/\s+/g, " "),
    age_group: ageGroupOf(division),
    organization: town.replace(/\s+/g, " "),
    color,
    // Head coach, if the sheet names one. Goes to the team's PRIVATE contact
    // doc (the admin's coach list), never the public site.
    coach_name: (r.coach ?? r.coach_name ?? "").replace(/\s+/g, " ").trim(),
    coach_email: coachEmail,
    coach_phone: (r.coach_phone ?? "").trim(),
  };
  teams.push(t);
  byName.set(key(name), t);
}
if (teams.length && teams.some((t) => t.age_group) && teams.some((t) => !t.age_group)) {
  warnings.push(
    "some divisions name a grade / age and some do not — the standings will show age sections for only part of the league",
  );
}

// ── gyms ────────────────────────────────────────────────────────────────

const gymRows = read("gyms.csv");
const gyms = [];
const gymNames = new Set();
for (const r of gymRows) {
  if (!r.name) {
    errors.push(`gyms.csv row ${r._row}: name is required`);
    continue;
  }
  if (gymNames.has(key(r.name))) {
    errors.push(`gyms.csv row ${r._row}: duplicate gym "${r.name}"`);
    continue;
  }
  gymNames.add(key(r.name));
  const g = { name: r.name.replace(/\s+/g, " "), address: r.address ?? "" };
  if (r.town) g.location = r.town;
  if (r.maps_url && /^https?:\/\//i.test(r.maps_url)) g.mapsUrl = r.maps_url;
  else if (r.maps_url) warnings.push(`gyms.csv row ${r._row}: maps_url must start with http(s)://, ignored`);
  if (!g.address) warnings.push(`gyms.csv row ${r._row}: "${g.name}" has no address — directions will not work`);
  gyms.push(g);
}

// ── schedule ────────────────────────────────────────────────────────────

const schedRows = read("schedule.csv");
const games = [];
const perDate = new Map();
const dates = new Set();
for (const r of schedRows) {
  const date = toIsoDate(r.date);
  const time = to24h(r.time);
  if (!date) errors.push(`schedule.csv row ${r._row}: date "${r.date}" — use YYYY-MM-DD or M/D/YYYY`);
  if (!time) errors.push(`schedule.csv row ${r._row}: time "${r.time}" — use 9:00 AM or 09:00`);
  const away = byName.get(key(r.away_team));
  const home = byName.get(key(r.home_team));
  if (!away) errors.push(`schedule.csv row ${r._row}: away team "${r.away_team}" is not in teams.csv`);
  if (!home) errors.push(`schedule.csv row ${r._row}: home team "${r.home_team}" is not in teams.csv`);
  if (away && home && away.id === home.id) errors.push(`schedule.csv row ${r._row}: a team cannot play itself`);
  if (!date || !time || !away || !home || away.id === home.id) continue;
  if (r.gym && !gymNames.has(key(r.gym))) {
    warnings.push(`schedule.csv row ${r._row}: gym "${r.gym}" is not in gyms.csv (kept as typed; add it to gyms.csv for directions)`);
  }
  const division = (r.division || away.division).replace(/\s+/g, " ");
  if (away.division !== home.division) {
    warnings.push(`schedule.csv row ${r._row}: ${away.name} (${away.division}) vs ${home.name} (${home.division}) crosses divisions`);
  }
  const hasScores = r.away_score !== "" && r.home_score !== "" && r.away_score != null && r.home_score != null;
  const a = hasScores ? Number(r.away_score) : null;
  const h = hasScores ? Number(r.home_score) : null;
  if (hasScores && (!Number.isFinite(a) || !Number.isFinite(h))) {
    errors.push(`schedule.csv row ${r._row}: scores must be numbers`);
    continue;
  }
  const n = (perDate.get(date) ?? 0) + 1;
  perDate.set(date, n);
  dates.add(date);
  games.push({
    id: `g-${date.replace(/-/g, "")}-${String(n).padStart(2, "0")}`,
    date,
    time,
    field: (r.gym || "").replace(/\s+/g, " "),
    away_team_id: away.id,
    home_team_id: home.id,
    division,
    status: hasScores ? "final" : "scheduled",
    away_score: hasScores ? a : "",
    home_score: hasScores ? h : "",
  });
}
const weekOf = new Map([...dates].sort().map((d, i) => [d, i + 1]));
for (const g of games) g.week = weekOf.get(g.date);

// ── report ──────────────────────────────────────────────────────────────

for (const w of warnings) console.warn(`  ⚠ ${w}`);
for (const e of errors) console.error(`  ✗ ${e}`);
if (errors.length) fail(`${errors.length} error(s) — nothing written`);

const divisions = [...new Set(teams.map((t) => t.division))].sort();
const towns = [...new Set(teams.map((t) => t.organization))].sort();
console.log(
  `[etbl-intake] ${teams.length} teams · ${divisions.length} divisions (${divisions.join(", ")}) · ${towns.length} towns (${towns.join(", ")}) · ${gyms.length} gyms · ${games.length} games over ${dates.size} dates`,
);
if (DRY) {
  console.log("[etbl-intake] --dry-run: nothing written.");
  process.exit(0);
}

// ── write ───────────────────────────────────────────────────────────────

fs.writeFileSync(
  path.join(ROOT, "teams.csv"),
  toCsv([
    ["id", "name", "abbrev", "division", "age_group", "organization", "color", "logo_url", "gamechanger_url", "coach_name", "coach_email", "coach_phone"],
    ...teams.map((t) => [t.id, t.name, t.abbrev, t.division, t.age_group, t.organization, t.color, "", "", t.coach_name, t.coach_email, t.coach_phone]),
  ]),
);
fs.writeFileSync(
  path.join(ROOT, "schedule.csv"),
  toCsv([
    ["id", "date", "time", "field", "away_team_id", "home_team_id", "week", "division", "status", "away_score", "home_score"],
    ...games.map((g) => [g.id, g.date, g.time, g.field, g.away_team_id, g.home_team_id, g.week, g.division, g.status, g.away_score, g.home_score]),
  ]),
);
fs.writeFileSync(path.join(ROOT, "fields.json"), JSON.stringify(gyms, null, 2) + "\n");

const provPath = path.join(ROOT, "provision.json");
const prov = JSON.parse(fs.readFileSync(provPath, "utf8"));
prov.league.fields = gyms.map((g) => g.name);
prov.league.flags = { ...(prov.league.flags ?? {}), demo_data: false };
fs.writeFileSync(provPath, JSON.stringify(prov, null, 2) + "\n");

console.log(
  "[etbl-intake] wrote data/etbl/teams.csv, schedule.csv, fields.json; provision.json fields updated and demo_data set to false.",
);
console.log("  next: npm run provision -- --config data/etbl/provision.json");
console.log("        npm run seed:fields -- --league etbl --file data/etbl/fields.json");
console.log("        (if the sample season is still up: Admin → Health → Remove sample season first)");

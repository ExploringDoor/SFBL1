// Arbiter schedule import / export.
//
// Some leagues run their schedule in ArbiterSports and are not going to stop.
// LCYBL is explicit about it: their own FAQ says "Arbiter is the master", and
// corrections are phoned in as "Age, Section, Game number". Fighting that would
// lose the league. So the site treats Arbiter as upstream and makes the
// round-trip painless in both directions.
//
// Two things make this more than a CSV parse:
//
//   1. Arbiter speaks TEAM NAMES; the platform speaks team ids. A human should
//      not have to hand-map 185 teams, so names are matched with a tolerance
//      ladder and anything ambiguous is reported for confirmation rather than
//      guessed at. A wrong auto-match silently attributes a game to the wrong
//      club, which is worse than asking.
//
//   2. The Arbiter GAME NUMBER is the join key. It is what the league already
//      uses to talk about a game, and it is what makes an import idempotent and
//      an export re-importable. It is preserved on every game and used to build
//      a stable doc id, so re-importing an updated export UPDATES games instead
//      of duplicating the season.
//
// Deliberately pure — no Firestore, no clock, no network.

/** One row as Arbiter describes it, before it is mapped onto team ids. */
export interface ArbiterRow {
  /** Arbiter's game number. The league's own handle for a game. */
  gameNumber?: string;
  /** ISO YYYY-MM-DD. */
  date: string;
  /** 24h HH:MM, or "" when the source had no usable time. */
  time: string;
  field: string;
  awayName: string;
  homeName: string;
  awayScore: number | null;
  homeScore: number | null;
  /** Age group / section / level as printed, when the export carries it. */
  division: string;
  /** 1-based line in the source file, for error reporting. */
  line: number;
}

export interface ArbiterParseResult {
  rows: ArbiterRow[];
  errors: { line: number; message: string }[];
  warnings: string[];
  /** Header labels present in the source that we did not consume. */
  ignoredColumns: string[];
  /** Which delimiter was detected, surfaced so a mis-detection is visible. */
  delimiter: "," | "\t" | ";";
}

// Header aliases. Arbiter's exports and the spreadsheets leagues derive from
// them are not consistent between versions or between leagues, so every column
// is matched against a list of things it is actually called in the wild rather
// than one canonical spelling.
const COLUMN_ALIASES: Record<string, string[]> = {
  gameNumber: ["game", "game #", "game#", "game number", "gamenumber", "game no", "no", "num", "#"],
  date: ["date", "game date", "gamedate", "day/date"],
  time: ["time", "start", "start time", "starttime", "game time"],
  field: ["site", "field", "location", "venue", "facility", "site name", "field name", "diamond"],
  awayName: ["away", "away team", "awayteam", "visitor", "visiting team", "visitors", "guest", "road"],
  homeName: ["home", "home team", "hometeam"],
  awayScore: ["away score", "awayscore", "visitor score", "v score", "away runs"],
  homeScore: ["home score", "homescore", "h score", "home runs"],
  division: ["division", "level", "sport", "league", "age", "age group", "section", "conference", "group"],
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Two-digit years. Arbiter exports "13-Apr-26" and a naive parse gives 1926.
 * Windowed rather than "always 20xx" so a genuinely old archive import is not
 * silently shifted a century; 70+ is treated as 19xx, which no active schedule
 * will ever contain.
 */
function expandYear(y: number): number {
  if (y >= 100) return y;
  return y >= 70 ? 1900 + y : 2000 + y;
}

/**
 * Parse the date formats these exports actually use:
 *   13-Apr-26 · 13 Apr 2026 · Apr 13, 2026 · 4/13/2026 · 04/13/26 · 2026-04-13
 *
 * Returns "" when the value is not confidently a date. Ambiguous D/M vs M/D is
 * resolved as US month-first (Arbiter is a US product), EXCEPT when the first
 * number cannot be a month, which is treated as day-first rather than rejected.
 */
export function parseArbiterDate(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";

  // Already ISO.
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;

  // 13-Apr-26 / 13 Apr 2026 / 13.Apr.26
  m = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ](\d{2,4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[2]!.toLowerCase().slice(0, 4).replace(/[^a-z]/g, "").slice(0, 4)]
      ?? MONTHS[m[2]!.toLowerCase().slice(0, 3)];
    if (mon) return `${expandYear(Number(m[3]))}-${pad(mon)}-${pad(Number(m[1]))}`;
  }

  // Apr 13, 2026 / April 13 2026
  m = /^([A-Za-z]{3,9})[ .]+(\d{1,2}),? *(\d{2,4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[1]!.toLowerCase().slice(0, 3)];
    if (mon) return `${expandYear(Number(m[3]))}-${pad(mon)}-${pad(Number(m[2]))}`;
  }

  // 4/13/2026 or 04/13/26 — US month-first, with a day-first fallback.
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = expandYear(Number(m[3]));
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) return `${year}-${pad(a)}-${pad(b)}`;
    if (b >= 1 && b <= 12 && a >= 1 && a <= 31) return `${year}-${pad(b)}-${pad(a)}`;
  }

  return "";
}

/**
 * Parse "6:00PM", "6:00 pm", "6PM", "18:00", "6:00p" into 24h HH:MM.
 * Returns "" when there is no usable time, which downstream treats as
 * "time unknown" rather than midnight.
 */
export function parseArbiterTime(raw: string): string {
  const s = String(raw ?? "").trim().toLowerCase().replace(/\./g, "");
  if (!s) return "";

  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/.exec(s);
  if (!m) return "";
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const mer = m[3];
  if (min > 59) return "";

  if (mer) {
    const isPm = mer === "pm" || mer === "p";
    if (h < 1 || h > 12) return "";
    if (isPm && h !== 12) h += 12;
    if (!isPm && h === 12) h = 0;
  } else if (h > 23) {
    return "";
  }
  return `${pad(h)}:${pad(min)}`;
}

/** A score cell. Blank, "-", and "TBD" are all "not played yet", not zero —
 *  treating them as 0 would publish phantom 0-0 finals across the season. */
export function parseScore(raw: string): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  // A trailing "B" is LCYBL's own marker for a double forfeit (score never
  // called in). The number in front of it is not a real score.
  if (/^\d+\s*b$/i.test(s)) return null;
  if (!/^\d{1,3}$/.test(s)) return null;
  return Number(s);
}

/** Split one delimited line, honouring quoted fields. */
export function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') {
      inQ = true;
    } else if (c === delim) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectDelimiter(headerLine: string): "," | "\t" | ";" {
  const counts: [",", number][] | [string, number][] = [
    [",", (headerLine.match(/,/g) ?? []).length],
    ["\t", (headerLine.match(/\t/g) ?? []).length],
    [";", (headerLine.match(/;/g) ?? []).length],
  ];
  counts.sort((a, b) => (b[1] as number) - (a[1] as number));
  const best = counts[0]!;
  return ((best[1] as number) > 0 ? best[0] : ",") as "," | "\t" | ";";
}

/**
 * Parse an Arbiter schedule export. Tolerant by design: leagues paste these out
 * of Excel, so the delimiter, the column order, and the column spellings all
 * vary. Anything unparseable is reported per line rather than dropped.
 */
export function parseArbiterSchedule(text: string): ArbiterParseResult {
  const errors: ArbiterParseResult["errors"] = [];
  const warnings: string[] = [];
  const rows: ArbiterRow[] = [];

  const lines = String(text ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return {
      rows,
      errors: [{ line: 0, message: "Needs a header row and at least one game row." }],
      warnings,
      ignoredColumns: [],
      delimiter: ",",
    };
  }

  const delimiter = detectDelimiter(lines[0]!);
  const header = splitLine(lines[0]!, delimiter).map((h) => h.trim().toLowerCase());

  // Map each source column onto a field, first alias wins.
  const colOf: Partial<Record<keyof typeof COLUMN_ALIASES, number>> = {};
  const consumed = new Set<number>();
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (let i = 0; i < header.length; i++) {
      if (consumed.has(i)) continue;
      if (aliases.includes(header[i]!)) {
        colOf[field as keyof typeof COLUMN_ALIASES] = i;
        consumed.add(i);
        break;
      }
    }
  }

  const ignoredColumns = header.filter((h, i) => !consumed.has(i) && h.length > 0);

  const missing: string[] = [];
  if (colOf.date === undefined) missing.push("date");
  if (colOf.awayName === undefined) missing.push("away team");
  if (colOf.homeName === undefined) missing.push("home team");
  if (missing.length > 0) {
    errors.push({
      line: 1,
      message:
        `Could not find column(s): ${missing.join(", ")}. ` +
        `Found: ${header.filter(Boolean).join(", ") || "(none)"}.`,
    });
    return { rows, errors, warnings, ignoredColumns, delimiter };
  }
  if (colOf.gameNumber === undefined) {
    warnings.push(
      "No game-number column found. Game numbers are what let a re-import " +
        "update games instead of duplicating them, and are how the league " +
        "refers to a game. Include Arbiter's game number if you can.",
    );
  }
  if (colOf.field === undefined) {
    warnings.push("No field/site column found — games will import with no field set.");
  }

  const get = (fields: string[], key: keyof typeof COLUMN_ALIASES): string => {
    const i = colOf[key];
    return i === undefined ? "" : (fields[i] ?? "").trim();
  };

  for (let i = 1; i < lines.length; i++) {
    const lineNum = i + 1;
    const fields = splitLine(lines[i]!, delimiter);
    // Fully blank rows are padding from Excel, not errors.
    if (fields.every((f) => f === "")) continue;

    const rawDate = get(fields, "date");
    const awayName = get(fields, "awayName");
    const homeName = get(fields, "homeName");

    // A row with neither team is a spacer or a section heading in a
    // spreadsheet-derived export; skip quietly rather than erroring 40 times.
    if (!awayName && !homeName) continue;

    const date = parseArbiterDate(rawDate);
    if (!date) {
      errors.push({ line: lineNum, message: `Could not read date "${rawDate}".` });
      continue;
    }
    if (!awayName || !homeName) {
      errors.push({
        line: lineNum,
        message: `Row has only one team (away "${awayName}", home "${homeName}").`,
      });
      continue;
    }

    rows.push({
      gameNumber: get(fields, "gameNumber") || undefined,
      date,
      time: parseArbiterTime(get(fields, "time")),
      field: get(fields, "field"),
      awayName,
      homeName,
      awayScore: parseScore(get(fields, "awayScore")),
      homeScore: parseScore(get(fields, "homeScore")),
      division: get(fields, "division"),
      line: lineNum,
    });
  }

  if (rows.length === 0 && errors.length === 0) {
    warnings.push("No game rows found.");
  }
  return { rows, errors, warnings, ignoredColumns, delimiter };
}

// ─── team-name matching ────────────────────────────────────────────────────

export interface MatchableTeam {
  id: string;
  name: string;
  abbrev?: string | null;
  /** Extra names this team is known by in Arbiter, set by the admin once and
   *  reused on every later import. */
  aliases?: string[] | null;
}

export type MatchConfidence = "exact" | "alias" | "normalized" | "ambiguous" | "none";

export interface TeamMatch {
  sourceName: string;
  teamId: string | null;
  confidence: MatchConfidence;
  /** Populated when more than one team matched equally well. */
  candidates: { id: string; name: string }[];
}

/** Lowercase, strip punctuation, collapse whitespace. "St. Leo's" and
 *  "St Leos" have to land on the same key. */
function normName(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[.'’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Resolve Arbiter's team names onto platform team ids.
 *
 * Only exact, alias, and unambiguous-normalized matches are auto-accepted.
 * Fuzzy/partial scoring is deliberately NOT used: at 185 teams, names like
 * "Hempfield Black" and "Hempfield Blue" differ by one token, and a scoring
 * function confident enough to be useful is also confident enough to silently
 * assign a game to the wrong club. Anything less than certain comes back as
 * `ambiguous` or `none` with candidates, for a human to confirm once.
 */
export function matchTeamNames(
  sourceNames: string[],
  teams: MatchableTeam[],
): TeamMatch[] {
  const byExact = new Map<string, MatchableTeam[]>();
  const byNorm = new Map<string, MatchableTeam[]>();
  const byAlias = new Map<string, MatchableTeam[]>();

  const add = (m: Map<string, MatchableTeam[]>, k: string, t: MatchableTeam) => {
    if (!k) return;
    const list = m.get(k);
    if (list) list.push(t);
    else m.set(k, [t]);
  };

  for (const t of teams) {
    add(byExact, t.name.trim(), t);
    add(byNorm, normName(t.name), t);
    if (t.abbrev) add(byNorm, normName(t.abbrev), t);
    for (const a of t.aliases ?? []) add(byAlias, normName(a), t);
  }

  const uniq = [...new Set(sourceNames.map((n) => n.trim()).filter(Boolean))];
  return uniq.map((sourceName): TeamMatch => {
    const exact = byExact.get(sourceName);
    if (exact && exact.length === 1) {
      return { sourceName, teamId: exact[0]!.id, confidence: "exact", candidates: [] };
    }
    const alias = byAlias.get(normName(sourceName));
    if (alias && alias.length === 1) {
      return { sourceName, teamId: alias[0]!.id, confidence: "alias", candidates: [] };
    }
    const norm = byNorm.get(normName(sourceName));
    if (norm && norm.length === 1) {
      return { sourceName, teamId: norm[0]!.id, confidence: "normalized", candidates: [] };
    }
    if (norm && norm.length > 1) {
      return {
        sourceName,
        teamId: null,
        confidence: "ambiguous",
        candidates: norm.map((t) => ({ id: t.id, name: t.name })),
      };
    }
    return { sourceName, teamId: null, confidence: "none", candidates: [] };
  });
}

// ─── export back to Arbiter ────────────────────────────────────────────────

export interface ExportableGame {
  arbiter_game_number?: string | null;
  date: string;
  time?: string | null;
  field?: string | null;
  away_team_id: string;
  home_team_id: string;
  away_score?: number | null;
  home_score?: number | null;
  division?: string | null;
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 24h HH:MM back to the 12h form Arbiter and the league's spreadsheets use. */
export function toDisplayTime(time: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? "").trim());
  if (!m) return "";
  const h24 = Number(m[1]);
  const mm = m[2]!;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${ampm}`;
}

/** ISO date back to Arbiter's "13-Apr-26". */
export function toDisplayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return String(iso ?? "");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mon = names[Number(m[2]) - 1] ?? "";
  return `${Number(m[3])}-${mon}-${m[1]!.slice(2)}`;
}

/**
 * Render games as a CSV the league can hand back to Arbiter.
 *
 * Column names and the date/time formats mirror what Arbiter emits, so the file
 * round-trips: exporting and re-importing is a no-op rather than a migration.
 * Team ids are resolved back to display names, because Arbiter has never heard
 * of our ids.
 */
export function toArbiterCsv(
  games: ExportableGame[],
  teams: MatchableTeam[],
): string {
  const nameOf = new Map(teams.map((t) => [t.id, t.name]));
  const header = [
    "Game", "Date", "Time", "Site", "Division",
    "Away Team", "Away Score", "Home Team", "Home Score",
  ];
  const lines = [header.join(",")];

  const sorted = [...games].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      String(a.time ?? "").localeCompare(String(b.time ?? "")) ||
      String(a.field ?? "").localeCompare(String(b.field ?? "")),
  );

  for (const g of sorted) {
    lines.push(
      [
        g.arbiter_game_number ?? "",
        toDisplayDate(g.date),
        toDisplayTime(g.time),
        g.field ?? "",
        g.division ?? "",
        nameOf.get(g.away_team_id) ?? g.away_team_id,
        g.away_score == null ? "" : String(g.away_score),
        nameOf.get(g.home_team_id) ?? g.home_team_id,
        g.home_score == null ? "" : String(g.home_score),
      ]
        .map((c) => csvCell(String(c)))
        .join(","),
    );
  }
  return lines.join("\n");
}

/**
 * Stable doc id for an imported game.
 *
 * Keyed on the Arbiter game number when there is one, so re-importing an
 * updated export updates the same rows instead of duplicating a 185-team
 * season. Without a game number it falls back to the natural key
 * (date + teams), which is stable for everything except a reschedule — and a
 * rescheduled game genuinely is a different row to Arbiter too.
 */
export function arbiterGameId(row: {
  gameNumber?: string | null;
  date: string;
  awayTeamId: string;
  homeTeamId: string;
}): string {
  const clean = (s: string) => s.replace(/[^a-z0-9]+/gi, "").toLowerCase();
  if (row.gameNumber && clean(row.gameNumber)) {
    return `arb-${clean(row.gameNumber)}`;
  }
  return `arb-${row.date.replace(/-/g, "")}-${clean(row.awayTeamId)}-${clean(row.homeTeamId)}`;
}

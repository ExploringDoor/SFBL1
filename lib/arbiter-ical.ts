// Arbiter iCal (feed) parser.
//
// ArbiterSports publishes a subscribable iCal schedule feed (Settings -> iCal
// Feed -> a messaging@arbitersports.com URL, or a per-org feed URL). Point us at
// that URL and the platform can pull the schedule and keep it current on its
// own, with no CSV export/upload step. That is what this file makes possible:
// it turns the feed's text into the SAME ArbiterRow[] shape the CSV importer
// produces, so everything downstream — team-name matching, the stable game id,
// the merge-not-clobber upsert — is reused unchanged.
//
// Deliberately pure: no network, no Firestore, no clock. The caller fetches the
// URL and hands the text in.
//
// What the feed carries and what it does not:
//   - Games: date, time, field (LOCATION), and the matchup (SUMMARY). Yes.
//   - Assigned officials: NO. Arbiter's schedule feed is games only; officials
//     ride on each official's personal feed, not the org schedule feed. So this
//     keeps the SCHEDULE current; umpires on the site come from the CSV
//     "Games with Official info" report or from AssignCrew.

import type { ArbiterRow } from "@/lib/arbiter";
import { parseArbiterTime } from "@/lib/arbiter";

/**
 * Normalize a feed URL string. Arbiter commonly hands out webcal:// links, and
 * the WHATWG URL protocol setter REFUSES to convert webcal (a non-special
 * scheme) to https — `u.protocol = "https:"` is a silent no-op — so the scheme
 * must be rewritten on the raw string before new URL().
 */
export function normalizeFeedUrl(raw: string): string {
  return String(raw ?? "").trim().replace(/^webcal:\/\//i, "https://");
}

export interface IcsRow extends ArbiterRow {
  /** The VEVENT UID — the stable key across reschedules. */
  uid: string;
  /** The raw SUMMARY, kept so an unparsed matchup can be shown to a human. */
  summary: string;
}

export interface IcsParseResult {
  rows: IcsRow[];
  errors: { index: number; message: string }[];
  warnings: string[];
  /** How many VEVENTs were seen, matched or not. */
  eventCount: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Unfold RFC 5545 folded lines: a CRLF (or LF) followed by a space or tab is a
 *  continuation of the previous line. */
function unfold(text: string): string[] {
  const raw = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Decode an iCal TEXT value: \\n -> newline, and \\, \; \\ \\ literals. */
function decodeText(v: string): string {
  return String(v ?? "")
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split "NAME;PARAM=x:value" into { name, params, value }. */
function splitProp(line: string): { name: string; params: Record<string, string>; value: string } {
  const colon = line.indexOf(":");
  if (colon < 0) return { name: line.toUpperCase(), params: {}, value: "" };
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = left.split(";");
  const name = parts[0]!.toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

/**
 * Convert a DTSTART value to a local wall-clock { date: YYYY-MM-DD, time: HH:MM }.
 *
 * - VALUE=DATE (8 digits): all-day, time = "".
 * - Floating or TZID form (YYYYMMDDTHHMMSS): the printed components ARE the local
 *   wall time — take them as-is. This is what an org schedule feed emits, and
 *   taking it literally is what avoids the "stamped local as UTC" hour-shift bug.
 * - UTC form (…Z): a real instant; convert to `timeZone` using Intl so DST is
 *   handled correctly (a fixed offset would be an hour off for half the year).
 */
function parseDtStart(value: string, isUtc: boolean, timeZone: string): { date: string; time: string } | null {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value.trim());
  if (dateOnly) return { date: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`, time: "" };

  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value.trim());
  if (!m) return null;
  const [, Y, Mo, D, H, Mi] = m;

  if (!isUtc && !m[7]) {
    // Floating or TZID: literal local wall time.
    return { date: `${Y}-${Mo}-${D}`, time: `${H}:${Mi}` };
  }

  // UTC instant -> zoned wall time.
  const instant = new Date(Date.UTC(+Y!, +Mo! - 1, +D!, +H!, +Mi!, +(m[6] ?? 0)));
  if (isNaN(instant.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(instant);
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    let hh = g("hour");
    if (hh === "24") hh = "00";
    return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${hh}:${g("minute")}` };
  } catch {
    return { date: `${Y}-${Mo}-${D}`, time: `${H}:${Mi}` };
  }
}

/**
 * Pull the two team names out of an event SUMMARY.
 *
 * Arbiter titles vary. Common shapes, in the order we try them:
 *   "Visitor at Home"      -> away at home  (the org-feed default)
 *   "Visitor @ Home"       -> away at home
 *   "Home vs Visitor"      -> home vs away
 *   "Home v. Visitor"      -> home vs away
 * A leading "Sport Level: " or "14U - " prefix is stripped when the remainder
 * still contains a separator. Orientation is a best guess; the admin sees a
 * sample in the preview before anything is written, and can fix it with aliases.
 */
export function splitMatchup(summary: string): { away: string; home: string } | null {
  let s = decodeText(summary);
  if (!s) return null;

  // Strip a leading "label:" or "label -" prefix if what follows still has a
  // matchup separator (so "Baseball 14U: A at B" -> "A at B").
  const sepRe = /\s+(?:at|@|vs\.?|v\.?)\s+/i;
  const stripPrefix = (str: string, delim: RegExp): string => {
    const idx = str.search(delim);
    if (idx > 0) {
      const after = str.slice(idx + str.match(delim)![0].length);
      if (sepRe.test(after)) return after;
    }
    return str;
  };
  s = stripPrefix(s, /:\s*/);
  s = stripPrefix(s, /\s+-\s+/);

  // "at" / "@" -> away at home
  let m = /^(.+?)\s+(?:at|@)\s+(.+)$/i.exec(s);
  if (m) return { away: cleanSide(m[1]!), home: cleanSide(m[2]!) };
  // "vs" / "v" -> home vs away
  m = /^(.+?)\s+(?:vs\.?|v\.?)\s+(.+)$/i.exec(s);
  if (m) return { home: cleanSide(m[1]!), away: cleanSide(m[2]!) };
  return null;
}

/** Trim trailing parenthetical notes, division tags, and stray punctuation from
 *  one side of a matchup ("Warwick Phillies (14U)" -> "Warwick Phillies"). */
function cleanSide(s: string): string {
  return s
    .replace(/\([^)]*\)\s*$/, "")
    .replace(/\s*[-–—]\s*\d+u\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseArbiterIcs(
  text: string,
  opts: { timeZone?: string } = {},
): IcsParseResult {
  const timeZone = opts.timeZone || "America/New_York";
  const errors: IcsParseResult["errors"] = [];
  const warnings: string[] = [];
  const rows: IcsRow[] = [];

  const lines = unfold(text);
  if (!lines.some((l) => l.toUpperCase().startsWith("BEGIN:VCALENDAR"))) {
    return {
      rows,
      errors: [{ index: 0, message: "This does not look like an iCal feed (no VCALENDAR)." }],
      warnings,
      eventCount: 0,
    };
  }

  let inEvent = false;
  let cur: Record<string, { params: Record<string, string>; value: string }> = {};
  let eventCount = 0;

  for (const line of lines) {
    const up = line.toUpperCase();
    if (up.startsWith("BEGIN:VEVENT")) { inEvent = true; cur = {}; continue; }
    if (up.startsWith("END:VEVENT")) {
      if (inEvent) buildRow(cur, eventCount + 1, timeZone, rows, errors);
      if (inEvent) eventCount++;
      inEvent = false; cur = {};
      continue;
    }
    if (!inEvent) continue;
    const { name, params, value } = splitProp(line);
    if (name === "DTSTART" || name === "SUMMARY" || name === "LOCATION" || name === "UID" || name === "DESCRIPTION") {
      cur[name] = { params, value };
    }
  }

  if (rows.length === 0 && errors.length === 0) {
    warnings.push("No games found in the feed.");
  }
  return { rows, errors, warnings, eventCount };
}

/** Build one IcsRow from a collected VEVENT (helper so the loop stays readable). */
function buildRow(
  cur: Record<string, { params: Record<string, string>; value: string }>,
  idx: number,
  timeZone: string,
  rows: IcsRow[],
  errors: IcsParseResult["errors"],
): void {
  const uid = (cur["UID"]?.value ?? "").trim();
  const summary = cur["SUMMARY"]?.value ?? "";
  const dt = cur["DTSTART"];
  if (!dt) { errors.push({ index: idx, message: `Event ${idx} has no start; skipped.` }); return; }
  const tzid = dt.params["TZID"];
  const isUtc = /Z$/.test(dt.value.trim()) || (tzid ?? "").toUpperCase() === "UTC";
  const when = parseDtStart(dt.value, isUtc, tzid && tzid.toUpperCase() !== "UTC" ? tzid : timeZone);
  if (!when) { errors.push({ index: idx, message: `Event ${idx} has an unreadable start "${dt.value}"; skipped.` }); return; }

  const matchup = splitMatchup(summary);
  if (!matchup) {
    errors.push({ index: idx, message: `Could not read the matchup from "${decodeText(summary)}"; skipped.` });
    return;
  }

  rows.push({
    uid: uid || `${when.date}-${matchup.away}-${matchup.home}`,
    summary: decodeText(summary),
    gameNumber: undefined,
    date: when.date,
    time: when.time ? (parseArbiterTime(when.time) || when.time) : "",
    field: decodeText(cur["LOCATION"]?.value ?? ""),
    awayName: matchup.away,
    homeName: matchup.home,
    awayScore: null,
    homeScore: null,
    division: "",
    line: idx,
  });
}

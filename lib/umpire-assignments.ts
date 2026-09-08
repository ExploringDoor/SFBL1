// ============================================================================
// What each umpire is scheduled for, and how to say it.
//
// One shaping function, two renderings. The email and the copy-for-texting
// panel MUST agree about who is on what: two implementations of "their
// upcoming games" would eventually disagree, and the failure mode is an
// umpire being told two different things about the same night.
//
// The property to protect above all: an umpire is only ever shown THEIR OWN
// games. Getting that wrong hands one official another official's schedule.
// ============================================================================

export interface AssignmentGame {
  id: string;
  /** YYYY-MM-DD */
  date?: string;
  /** HH:MM, 24 hour */
  time?: string;
  field?: string;
  umpires?: string[];
  away_team_id?: string;
  home_team_id?: string;
}

export interface AssignmentLine {
  date: string;
  time: string;
  field: string;
  matchup: string;
}

/**
 * Group upcoming games by the umpire working them.
 *
 * `today` is a YYYY-MM-DD in LEAGUE time, not the server's. A game earlier
 * today still counts; last month's would bury the real ones.
 */
export function upcomingByUmpire(
  games: AssignmentGame[],
  teamName: Map<string, string>,
  today: string,
  only?: Set<string>,
): Map<string, AssignmentLine[]> {
  const out = new Map<string, AssignmentLine[]>();
  const dated = games
    .filter((g) => String(g.date ?? "").slice(0, 10) >= today)
    .sort((a, b) =>
      `${a.date ?? ""}${a.time ?? ""}`.localeCompare(`${b.date ?? ""}${b.time ?? ""}`),
    );
  for (const g of dated) {
    const crew = Array.isArray(g.umpires) ? g.umpires.map(String) : [];
    if (crew.length === 0) continue;
    const away = teamName.get(String(g.away_team_id ?? "")) ?? "";
    const home = teamName.get(String(g.home_team_id ?? "")) ?? "";
    const line: AssignmentLine = {
      date: String(g.date ?? "").slice(0, 10),
      time: String(g.time ?? ""),
      field: String(g.field ?? ""),
      matchup: away && home ? `${away} at ${home}` : "",
    };
    for (const id of crew) {
      if (only && !only.has(id)) continue;
      out.set(id, [...(out.get(id) ?? []), line].slice(0, 60));
    }
  }
  return out;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-09-14" -> "Mon 9/14". Parsed as a plain calendar date, deliberately:
 *  these are floating wall-clock values and `new Date("2026-09-14")` would
 *  read them as UTC and slide to the 13th west of Greenwich. */
export function shortDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${DOW[d.getDay()]} ${Number(m[2])}/${Number(m[3])}`;
}

/** "18:00" -> "6:00 PM". Blank stays blank rather than becoming midnight. */
export function shortTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return "";
  const h = Number(m[1]);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m[2]} ${ap}`;
}

/** One line as a human reads it: "Mon 9/14 6:00 PM, Bellport 1 - Thunder at Waves" */
export function renderLine(l: AssignmentLine, sep = " - "): string {
  const when = [shortDate(l.date), shortTime(l.time)].filter(Boolean).join(" ");
  const where = l.field;
  const head = [when, where].filter(Boolean).join(", ");
  return l.matchup ? `${head}${sep}${l.matchup}` : head;
}

/**
 * Force a string into plain ASCII for SMS.
 *
 * NOT cosmetic. A single character outside the GSM-7 alphabet flips the whole
 * message to UCS-2, which cuts the segment size from 160 characters to 70, so
 * one stray em-dash or curly quote turns a one-part text into three. Team
 * names come from whatever the office typed, so this cannot be assumed clean.
 */
export function toSmsSafe(s: string): string {
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E\n]/g, "");
}

/** 160 for a plain-ASCII message, 153 per part once it has to be split. */
export function smsSegments(text: string): number {
  const n = text.length;
  if (n === 0) return 0;
  return n <= 160 ? 1 : Math.ceil(n / 153);
}

/**
 * The message the assignor copies into their phone.
 *
 * Short on purpose. An umpire reading this on a phone wants when and where;
 * the full detail is on the site. Kept to plain ASCII so it stays 160 to a
 * segment.
 */
export function smsFor(
  umpireName: string,
  lines: AssignmentLine[],
  leagueName: string,
): string {
  const first = umpireName.trim().split(/\s+/)[0] ?? "";
  const head = first ? `${first}, ` : "";
  const what = lines.length === 1 ? "your game" : `your ${lines.length} games`;
  const body = lines.map((l) => renderLine(l, " - ")).join("\n");
  return toSmsSafe(
    `${head}${what} for ${leagueName}:\n${body}\nReply if you can't make it.`,
  );
}

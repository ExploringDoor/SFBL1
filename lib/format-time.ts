// "HH:MM" (24-hour, the storage format used by ScheduleEditor and the
// CSV importer) → "h:mm AM/PM" for display. Adam's call: nobody
// reads "16:00" as 4 PM at a glance, and the admin / captain /
// print views shouldn't make people decode it.
//
// Returns the input unchanged when it doesn't match HH:MM (e.g. an
// already-formatted "4:00 PM" or an empty string) so it's safe to
// pipe arbitrary user data through it.

// Stitch a separately-stored date ("YYYY-MM-DD") and time ("HH:MM")
// into one ISO-ish string so `new Date(...)` returns the right
// instant. Some game docs store date+time combined ("2026-05-17T09:05:00")
// and some keep them apart — this normalizes to the combined shape
// so downstream renderers (Ticker, PreviewCard, GameCard) don't all
// have to know about the split. Returns `date` unchanged when:
//   - date already includes a T (combined storage)
//   - time is empty (no posted start time)
//   - date is falsy
export function combineDateTime(
  date: string | null | undefined,
  time: string | null | undefined,
): string {
  if (!date) return "";
  // Common case: clean YYYY-MM-DD + clean HH:MM. Stitch them.
  if (!time) {
    // Date may be ISO (with T + offset/Z). Returning as-is means
    // downstream `new Date()` will TZ-shift; that's fine when no
    // separate time was stored — the ISO IS the source of truth.
    return date;
  }
  // If the date string also includes a T-time component, throw it
  // away — the separate `time` field is authoritative (Adam ran
  // into "Generals @ Black Sox should be 12 PM" because the date
  // ended up stored as "2026-05-18T00:00:00.000Z" and a naive ISO
  // return shifted the game to 5 PM the previous day in Pacific).
  const t = /^\d{1,2}:\d{2}$/.test(time) ? `${time}:00` : time;
  return `${date.slice(0, 10)}T${t}`;
}

// Audit M3: strict 24-hour "HH:MM" validator (hour 0-23, minute
// 0-59). Use this at WRITE time — a bare /^\d{1,2}:\d{2}$/ accepts
// nonsense like "25:00" or "9:75". Returns false for null/empty so
// callers can branch cleanly.
export function isValidClockTime(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

/**
 * Format a stored 24-hour "HH:MM" string as "h:mm AM/PM".
 *
 * Contract (audit M9): this returns a 12-hour string ONLY when the
 * input is a parseable, in-range 24-hour time. For anything else —
 * already-formatted strings ("4:00 PM"), out-of-range values
 * ("25:00", "9:75"), or non-time text — it ECHOES the input back
 * unchanged (empty string for null/empty). It is deliberately safe
 * to pipe arbitrary user data through; it is NOT a validator. Use
 * isValidClockTime() if you need to reject bad input at write time.
 */
export function formatTime12(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return raw;
  const h24 = Number(m[1]);
  const mm = m[2];
  // Audit M3: also reject an out-of-range minute, not just the hour.
  if (h24 < 0 || h24 > 23 || Number(mm) > 59) return raw;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${period}`;
}

// Parse a game's date (+ optional separate time) into a Date that
// sits on the league's intended WALL CLOCK — never UTC-shifting the
// calendar day.
//
// The trap this exists to kill (audit H1): `new Date("2026-05-16")`
// is parsed by JS as 00:00 UTC, which renders as the *previous
// evening* for any viewer west of UTC. SFBL stores combined ISO
// ("2026-05-16T19:00:00") so it looked fine in Eastern; LBDC stores
// date-only "YYYY-MM-DD" + a separate time field, so every LBDC date
// label was skewing a day for Pacific users.
//
// Behavior:
//   - "YYYY-MM-DD" (+ optional time)  → LOCAL midnight of that day
//     (calendar day is stable for every viewer regardless of TZ),
//     with the separate time stitched in when provided.
//   - already-combined ISO ("…T09:05:00", no Z) → native parse,
//     which is local — preserves SFBL's existing correct rendering.
//   - bogus combined-with-Z ("…T00:00:00.000Z") + separate time →
//     the Z time is discarded in favor of the authoritative `time`
//     field (same precedence combineDateTime uses).
export function parseGameDate(
  date: string | null | undefined,
  time?: string | null | undefined,
): Date | null {
  if (!date) return null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!ymd) {
    const dt = new Date(date);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const hasTComponent = /T\d{2}:\d{2}/.test(date);
  // A combined ISO with a real time component AND no separate time
  // field: trust the embedded local time (SFBL path).
  if (hasTComponent && !time && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(date)) {
    const dt = new Date(date);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const y = Number(ymd[1]);
  const mo = Number(ymd[2]);
  const day = Number(ymd[3]);
  let hh = 0;
  let mm = 0;
  if (time) {
    const tm = /^(\d{1,2}):(\d{2})/.exec(time.trim());
    if (tm) {
      hh = Number(tm[1]);
      mm = Number(tm[2]);
    }
  }
  // Local-time construction — the calendar day never shifts.
  return new Date(y, mo - 1, day, hh, mm, 0, 0);
}

// Format a game date for display without the UTC-midnight shift.
// Default shape: "Sat, May 16". Pass Intl options to customize.
// Returns "" for missing/unparseable input so it's safe to inline.
export function formatGameDate(
  date: string | null | undefined,
  time?: string | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): string {
  const dt = parseGameDate(date, time);
  if (!dt) return "";
  return dt.toLocaleDateString(
    "en-US",
    opts ?? { weekday: "short", month: "short", day: "numeric" },
  );
}

// The league's wall-clock calendar day, e.g. "2026-07-31".
//
// Why this exists: server components run on Vercel in UTC, so a bare
// `new Date()` there is already "tomorrow" after ~8 PM Eastern. Anything
// that asks "is it past date X yet?" — most importantly pitcher-eligibility
// rest windows — must ask in the LEAGUE's timezone, not the server's, or it
// clears a resting pitcher up to a day early during evening games.
//
// en-CA formats as YYYY-MM-DD, which is exactly the key format used for
// game dates and pitch outings.
//
// All current tenants play in US Eastern. TODO: read this off the league
// config once a `timezone` field lands there.
export const DEFAULT_LEAGUE_TZ = "America/New_York";

export function leagueToday(timeZone: string = DEFAULT_LEAGUE_TZ): string {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone });
  } catch {
    // Unknown timezone string — fall back to the server's local day rather
    // than throwing on a page render.
    return new Date().toLocaleDateString("en-CA");
  }
}

/** The real instant a game starts, for a calendar feed or a countdown.
 *
 *  The `time` field ("HH:MM") is the authoritative wall clock, exactly as
 *  combineDateTime and parseGameDate treat it. The stored `date` may be a
 *  bare day or an ISO instant; an instant was minted on whichever machine
 *  ran the import, in THAT machine's zone, so it cannot be trusted for a
 *  league in another zone. Day + `time` + the league's zone can. Only when
 *  there is no `time` at all does an offset-bearing `date` win, which keeps
 *  older docs exactly where they were.
 */
export function gameStartInstant(
  date: string | null | undefined,
  time: string | null | undefined,
  timeZone: string,
): Date | null {
  if (!date) return null;
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(date)?.[1];
  if (!day) {
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const clock = /^(\d{1,2}):(\d{2})/.exec(String(time ?? "").trim());
  if (!clock) {
    if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(date)) {
      const d = new Date(date);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const embedded = /T(\d{2}):(\d{2})/.exec(date);
    return floatingToUtc(
      embedded ? `${day}T${embedded[1]}:${embedded[2]}` : day,
      timeZone,
    );
  }
  return floatingToUtc(
    `${day}T${clock[1]!.padStart(2, "0")}:${clock[2]}`,
    timeZone,
  );
}

/** Resolve a FLOATING local timestamp ("2026-09-14T18:00:00", no zone) into
 *  the real UTC instant it denotes in `timeZone`.
 *
 *  Game dates are stored floating on purpose — combineDateTime keeps the
 *  calendar day from shifting, and parseGameDate renders them as-is so a
 *  6:00 PM game reads "6:00 PM" to everyone. That is right for DISPLAY and
 *  wrong for a COUNTDOWN: `new Date("2026-09-14T18:00:00")` means 6 PM in
 *  the VIEWER's zone, so a parent watching from California would be counting
 *  down to the wrong moment by three hours.
 *
 *  Works by asking Intl what the naive-UTC reading of the wall clock looks
 *  like in the target zone, then subtracting the difference. Handles DST
 *  because the offset is sampled at that date, not today.
 *
 *  Returns null on an unparseable input. */
export function floatingToUtc(
  floating: string | null | undefined,
  timeZone: string,
): Date | null {
  if (!floating) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(floating);
  if (!m) return null;
  const naiveUtc = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
  );
  if (Number.isNaN(naiveUtc)) return null;
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(naiveUtc))) {
    p[part.type] = part.value;
  }
  // hour can come back as "24" at midnight in some engines.
  const seen = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  if (Number.isNaN(seen)) return null;
  return new Date(naiveUtc - (seen - naiveUtc));
}

/** Serialise an instant as an iCalendar UTC stamp: YYYYMMDDTHHMMSSZ.
 *
 *  Lives here rather than in the feed route so it can be tested against
 *  gameStartInstant, which is the pairing that has now been wrong twice: a
 *  "Z" stamp is an absolute instant, so a wall clock written straight into it
 *  moves every subscriber's copy of the game by the league's UTC offset. */
export function formatICalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// When the shop is open.
//
// Mike, 2026-09-07: "once we close the store on Wednesday night 12 midnight. We
// like to open the store back up on sat morning 6am to sell any shirts we have
// left at the field."
//
// So it is a weekly window, not a one off: orders close at the end of Wednesday
// so the pile can be sorted and printed, and reopen at the field on Saturday
// morning for whatever is left.
//
// "WEDNESDAY NIGHT 12 MIDNIGHT" IS THE END OF WEDNESDAY, not the start of it.
// Read the other way the shop would shut a day early every week, so it is
// written down here rather than left to whoever next reads the code.
//
// EVERYTHING IS NEW YORK TIME. The server runs in UTC and the coaches are on
// Long Island; a window expressed in UTC would drift by an hour twice a year
// and shut the shop at 1am one week and 11pm the next. Intl does the
// conversion, including the DST change, without a date library.

export interface StoreHours {
  /** Off entirely: the shop is always open, which is the default. */
  enabled: boolean;
  /** 0 = Sunday. Orders stop at the END of this day. */
  closeDay: number;
  /** 0 = Sunday. Orders start again at openTime on this day. */
  openDay: number;
  /** "HH:MM", 24 hour, New York time. */
  openTime: string;
  /** Shown to a shopper while it is shut. */
  closedNote: string;
}

export const DEFAULT_STORE_HOURS: StoreHours = {
  enabled: false,
  closeDay: 3, // Wednesday
  openDay: 6, // Saturday
  openTime: "06:00",
  closedNote:
    "Ordering is closed while we sort this week's shirts. It opens again Saturday at 6am, and we sell whatever is left at the field.",
};

/** New York wall-clock day and minutes past midnight for an instant. */
export function nyParts(now: Date): { day: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = days.indexOf(parts.weekday ?? "");
  // Intl renders midnight as "24" in some runtimes with hour12:false.
  const hour = Number(parts.hour) % 24;
  return { day, minutes: hour * 60 + Number(parts.minute) };
}

function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return 0;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

/**
 * Is the shop taking orders right now?
 *
 * The CLOSED stretch runs from the end of closeDay until openTime on openDay.
 * Anything outside that is open, which is deliberately the safe direction: a
 * misconfigured window leaves the shop selling rather than silently shut.
 */
export function isStoreOpen(now: Date, hours: StoreHours): boolean {
  if (!hours.enabled) return true;
  const { day, minutes } = nyParts(now);
  if (day < 0) return true; // could not read the clock: stay open

  const openAt = toMinutes(hours.openTime);
  // Days strictly between the close day and the open day, walking forwards.
  const closedStart = (hours.closeDay + 1) % 7; // the day after close day
  let d = closedStart;
  for (let i = 0; i < 7; i++) {
    if (d === hours.openDay) break;
    if (d === day) return false; // a fully closed day
    d = (d + 1) % 7;
  }
  // The opening day itself is shut until openTime.
  if (day === hours.openDay && minutes < openAt) return false;
  return true;
}

/** Read a stored document into a usable schedule, defaults for anything odd. */
export function readStoreHours(data: unknown): StoreHours {
  const d = (data ?? {}) as Partial<StoreHours>;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 6 ? v : fallback;
  return {
    // Only an explicit true schedules a closure. A half-written document must
    // never shut a shop nobody meant to shut.
    enabled: d.enabled === true,
    closeDay: num(d.closeDay, DEFAULT_STORE_HOURS.closeDay),
    openDay: num(d.openDay, DEFAULT_STORE_HOURS.openDay),
    openTime:
      typeof d.openTime === "string" && /^\d{1,2}:\d{2}$/.test(d.openTime)
        ? d.openTime
        : DEFAULT_STORE_HOURS.openTime,
    closedNote:
      typeof d.closedNote === "string" && d.closedNote.trim()
        ? d.closedNote.trim()
        : DEFAULT_STORE_HOURS.closedNote,
  };
}

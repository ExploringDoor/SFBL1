// When the shop is open.
//
// Mike, 2026-09-08: "they want the store to close Thursday 4pm not wed at 12pm
// midnight." Reopening is unchanged, Saturday 6am at the field.
//
// So it is a weekly window, not a one off: orders close Thursday afternoon so
// the pile can be sorted and printed, and reopen at the field on Saturday
// morning for whatever is left.
//
// The close is a TIME OF DAY, not the end of a day. It was end-of-day when the
// ask was "Wednesday night 12 midnight", and a stored document with no
// closeTime still means exactly that, so an older tenant document keeps
// working. See closeTime below.
//
// EVERYTHING IS NEW YORK TIME. The server runs in UTC and the coaches are on
// Long Island; a window expressed in UTC would drift by an hour twice a year
// and shut the shop at 1am one week and 11pm the next. Intl does the
// conversion, including the DST change, without a date library.

export interface StoreHours {
  /** Off entirely: the shop is always open, which is the default. */
  enabled: boolean;
  /** 0 = Sunday. Orders stop on this day, at closeTime. */
  closeDay: number;
  /** "HH:MM", 24 hour, New York time. null means the END of closeDay, which
   *  is what the original "Wednesday night 12 midnight" wording meant and
   *  what a document written before closeTime existed still means. */
  closeTime: string | null;
  /** 0 = Sunday. Orders start again at openTime on this day. */
  openDay: number;
  /** "HH:MM", 24 hour, New York time. */
  openTime: string;
  /** Shown to a shopper while it is shut. */
  closedNote: string;
}

export const DEFAULT_STORE_HOURS: StoreHours = {
  enabled: false,
  closeDay: 4, // Thursday
  closeTime: "16:00", // 4pm
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

/** Minutes since Sunday 00:00, New York wall clock. */
function weekMinutes(day: number, minutes: number): number {
  return day * 1440 + minutes;
}

/**
 * Is the shop taking orders right now?
 *
 * Both ends of the window are points in the week, so the shut stretch is just
 * the span between them and it may wrap across Sunday. Anything outside it is
 * open, which is deliberately the safe direction: a misconfigured window
 * leaves the shop selling rather than silently shut.
 */
export function isStoreOpen(now: Date, hours: StoreHours): boolean {
  if (!hours.enabled) return true;
  const { day, minutes } = nyParts(now);
  if (day < 0) return true; // could not read the clock: stay open

  const t = weekMinutes(day, minutes);
  // No closeTime means the END of closeDay, i.e. midnight rolling into the
  // next day. That is the pre-closeTime meaning and stored docs still use it.
  const close =
    hours.closeTime === null
      ? weekMinutes((hours.closeDay + 1) % 7, 0)
      : weekMinutes(hours.closeDay, toMinutes(hours.closeTime));
  const open = weekMinutes(hours.openDay, toMinutes(hours.openTime));

  if (close === open) return true; // zero-length closure: never shut
  return close < open
    ? !(t >= close && t < open) // shut stretch sits inside the week
    : !(t >= close || t < open); // shut stretch wraps across Sunday
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
    // Absent is meaningful here, so it is NOT filled from the default: a
    // document written before closeTime existed means end-of-day, and
    // quietly giving it 4pm would shut those shops eight hours early.
    closeTime:
      typeof d.closeTime === "string" && /^\d{1,2}:\d{2}$/.test(d.closeTime)
        ? d.closeTime
        : null,
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

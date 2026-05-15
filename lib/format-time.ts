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

export function formatTime12(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return raw;
  const h24 = Number(m[1]);
  const mm = m[2];
  if (h24 < 0 || h24 > 23) return raw;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${period}`;
}

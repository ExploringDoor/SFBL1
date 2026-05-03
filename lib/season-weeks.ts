// Group game dates into weeks (Monday-start) for the schedule/scores
// week selector. Returns a sorted list of weeks with start ISO date,
// list of dates in that week, and a date-range label.
//
// "WK N" numbering starts at 1 from the earliest week containing any
// game (regardless of status).

export interface WeekBucket {
  startIso: string;       // YYYY-MM-DD of the Monday
  number: number;
  dates: string[];        // unique YYYY-MM-DD strings, ascending
  rangeLabel: string;     // "Apr 20–22" or "May 3"
}

function mondayOf(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function shortDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function computeWeeks(
  games: Array<{ date: string }>,
): WeekBucket[] {
  const byMonday = new Map<string, Set<string>>();
  for (const g of games) {
    if (!g.date) continue;
    const day = g.date.slice(0, 10);
    const mon = mondayOf(day);
    if (!byMonday.has(mon)) byMonday.set(mon, new Set());
    byMonday.get(mon)!.add(day);
  }

  const sorted = [...byMonday.entries()].sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([startIso, dateSet], i) => {
    const dates = [...dateSet].sort();
    const range =
      dates.length === 1
        ? shortDate(dates[0]!)
        : sameMonth(dates[0]!, dates[dates.length - 1]!)
          ? `${shortDate(dates[0]!)}–${dayOnly(dates[dates.length - 1]!)}`
          : `${shortDate(dates[0]!)}–${shortDate(dates[dates.length - 1]!)}`;
    return { startIso, number: i + 1, dates, rangeLabel: range };
  });
}

function sameMonth(a: string, b: string) {
  return a.slice(0, 7) === b.slice(0, 7);
}
function dayOnly(iso: string): string {
  return String(parseInt(iso.slice(8, 10), 10));
}

// Pick the "current" week to highlight: the earliest week whose Monday
// is on or after today, falling back to the last week if all are past.
export function pickActiveWeek(weeks: WeekBucket[], today: Date = new Date()): string | null {
  if (weeks.length === 0) return null;
  const todayIso = today.toISOString().slice(0, 10);
  const upcoming = weeks.find((w) => w.startIso >= mondayOf(todayIso));
  const fallback = weeks[weeks.length - 1]!;
  return (upcoming ?? fallback).startIso;
}

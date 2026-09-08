"use client";

// Opening Day countdown band. Replaces the registration CTA on Island's
// homepage once the schedule is up (Adam, 2026-09-08: "take off the
// registration banner and add a countdown to monday's OPENING DAY").
//
// `targetIso` is a real UTC instant resolved on the SERVER from the first
// scheduled game, so every viewer counts down to the same moment. Do not
// pass the raw game date: those are stored floating ("2026-09-14T18:00:00",
// meaning Eastern), and new Date() on that would target 6 PM in whatever
// zone the viewer happens to be in.

import { useEffect, useState } from "react";

function parts(msLeft: number) {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    mins: Math.floor((s % 3600) / 60),
    secs: s % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function OpeningDayCountdown({
  targetIso,
  dateLabel,
  href = "/schedule",
}: {
  /** Absolute instant of first pitch, e.g. "2026-09-14T22:00:00.000Z". */
  targetIso: string;
  /** Human date for the headline, e.g. "Monday, September 14". */
  dateLabel: string;
  href?: string;
}) {
  const target = new Date(targetIso).getTime();

  // Seeded synchronously so the server emits real numbers and there is no
  // blank flash on first paint. Server and client are a second or two apart
  // by definition, which is what suppressHydrationWarning below is for.
  const [left, setLeft] = useState(() => target - Date.now());

  useEffect(() => {
    const tick = () => setLeft(target - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  // Live through the whole opening day, then the band retires itself.
  if (left <= 0) {
    const sinceStart = -left;
    if (sinceStart > 12 * 3600 * 1000) return null;
    return (
      <section className="le-countdown le-countdown--live">
        <div className="container le-countdown-inner">
          <div>
            <p className="le-countdown-eyebrow">Opening Day</p>
            <p className="le-countdown-head">It&rsquo;s here. Play ball.</p>
          </div>
          <a href={href} className="le-countdown-btn">
            View the schedule
          </a>
        </div>
      </section>
    );
  }

  const { days, hours, mins, secs } = parts(left);
  const cells: [number, string][] = [
    [days, days === 1 ? "Day" : "Days"],
    [hours, "Hrs"],
    [mins, "Min"],
    [secs, "Sec"],
  ];

  return (
    <section className="le-countdown">
      <div className="container le-countdown-inner">
        <div className="le-countdown-copy">
          <p className="le-countdown-eyebrow">Opening Day</p>
          <p className="le-countdown-head">{dateLabel}</p>
        </div>
        {/* One live region for the whole clock, polite and updating only
            on the minute would still read every second to a screen reader,
            so the clock is aria-hidden and the label below carries it. */}
        <div className="le-countdown-clock" aria-hidden="true">
          {cells.map(([n, label], i) => (
            <div className="le-countdown-cell" key={label}>
              <span className="le-countdown-num" suppressHydrationWarning>
                {i === 0 ? n : pad(n)}
              </span>
              <span className="le-countdown-lbl">{label}</span>
            </div>
          ))}
        </div>
        <p className="sr-only" suppressHydrationWarning>
          {days} days, {hours} hours and {mins} minutes until Opening Day on{" "}
          {dateLabel}.
        </p>
        <a href={href} className="le-countdown-btn">
          Full schedule
        </a>
      </div>
    </section>
  );
}

// The next three tournaments, on the home page.
//
// Mike asked for this (via Adam, 2026-08-14). Tournaments are the paid side of
// Island's business and they were reachable only from the nav, so a parent who
// landed on the home page for a score never saw that there was anything to
// enter.
//
// Reads the SAME checked-in slate the tournaments page renders, so the two can
// never disagree about a date or a price. If that file ever moves into the
// database, this moves with it and nothing here needs rethinking.
//
// "Upcoming" is measured against the END date, not the start: a tournament
// running Saturday to Sunday should still be listed on the Sunday morning,
// which is exactly when someone checks the site. Dates are parsed at noon UTC
// for the reason the tournaments page documents — a date-only string slips to
// the previous day in any negative-offset timezone, and Long Island is one.
//
// Renders nothing once the slate is exhausted rather than showing a stale
// "upcoming" heading over three finished events.

import Link from "next/link";
import islandData from "@/app/tournaments/island-fall-2026.json";

interface SlateEvent {
  name: string;
  subtitle?: string;
  start: string;
  end?: string;
  ages?: string;
  levels?: string;
  guarantee?: string;
  cost?: string;
  usssa_event?: string;
  /** Poster art for the event, served from /public. Optional: Mike sends
   *  these as he has them, so most of the slate has none yet. */
  logo?: string;
}

function asDate(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

function fmt(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return asDate(iso).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

/** "Sep 12-13", or "Sep 12" for a one-day event. */
function dateLabel(e: SlateEvent): string {
  const mon = fmt(e.start, { month: "short" });
  const d1 = fmt(e.start, { day: "numeric" });
  if (!e.end || e.end === e.start) return `${mon} ${d1}`;
  const d2 = fmt(e.end, { day: "numeric" });
  // A weekend crossing a month needs the second month named too, or
  // "Oct 31-1" reads as a typo.
  const mon2 = fmt(e.end, { month: "short" });
  return mon2 === mon ? `${mon} ${d1}-${d2}` : `${mon} ${d1} - ${mon2} ${d2}`;
}

function usssaUrl(eventId: string): string {
  return `https://www.usssa.com/fastpitch/TournamentMain/#/?eventID=${eventId}&gdSport=16`;
}

export function UpcomingTournaments({ limit = 3 }: { limit?: number }) {
  const all = (islandData as { events: SlateEvent[] }).events ?? [];

  // Midnight UTC today, compared against each event's last day. Comparing ISO
  // strings directly would work too, but only by accident of format; this
  // stays correct if a date ever arrives with a time on it.
  const today = new Date();
  const cutoff = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );

  const upcoming = all
    .filter((e) => asDate(e.end || e.start).getTime() >= cutoff)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, limit);

  if (upcoming.length === 0) return null;

  return (
    <section className="le-upcoming" aria-label="Upcoming tournaments">
      <div className="le-upcoming-head">
        <h2 className="le-upcoming-title">Upcoming Tournaments</h2>
        <Link href="/tournaments" className="le-upcoming-all">
          All tournaments <span aria-hidden>→</span>
        </Link>
      </div>

      <div className="le-upcoming-grid">
        {upcoming.map((e) => (
          <article key={`${e.name}-${e.start}`} className="le-upcoming-card">
            {/* Poster tile.
                Each logo arrives on its OWN opaque background — Never Forget
                is navy, Labor Day is light grey — so they are shown as square
                tiles keeping that background rather than cut out onto the
                card. Trying to blend them would fight artwork we do not have
                the layers for.
                object-fit: cover with a square box and square source means no
                crop and no distortion; it is `cover` rather than `contain`
                only so a stray off-square file still fills the tile.
                Missing logos fall back to the league mark, so a card without
                art is the same height as one with it and the row stays even.
                Mike has sent two of thirteen. */}
            <span className="le-upcoming-art">
              <img
                src={e.logo || "/island/logo.png"}
                alt=""
                loading="lazy"
                decoding="async"
                className={
                  e.logo ? "le-upcoming-art-img" : "le-upcoming-art-img le-upcoming-art-fallback"
                }
              />
            </span>
            <span className="le-upcoming-date">{dateLabel(e)}</span>
            <h3 className="le-upcoming-name">{e.name}</h3>
            <div className="le-upcoming-meta">
              {e.ages && <span className="le-upcoming-chip">{e.ages}</span>}
              {e.cost && (
                <span className="le-upcoming-chip le-upcoming-chip-cost">
                  {e.cost}
                </span>
              )}
            </div>
            {e.usssa_event && (
              <a
                className="le-upcoming-reg"
                href={usssaUrl(e.usssa_event)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Register on USSSA <span aria-hidden>→</span>
              </a>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

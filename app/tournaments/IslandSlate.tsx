// Island Fastpitch tournament slate.
//
// Mike's tournaments lived on the old Wix site at islandfastpitch.com/tournaments
// as thirteen Wix event pages, each with a Register button pointing at a USSSA
// eventID. Adam asked for that content on the new site with everything linking
// straight to USSSA (2026-08-02), so this renders the slate and every button
// goes to the same USSSA event the old site sent teams to. Nothing registers
// here; USSSA owns that.
//
// Data is a checked-in JSON file rather than tenant config, same as the summer
// league standings. The slate is a fixed annual list published once, and no
// admin screen edits config.tournaments today, so Firestore would only add a
// place for it to drift.

import islandData from "./island-fall-2026.json";

interface IslandEvent {
  name: string;
  subtitle?: string;
  start: string;
  end?: string;
  ages?: string;
  levels?: string;
  guarantee?: string;
  cost?: string;
  usssa_event?: string;
  contact?: string;
}

// USSSA's tournament page is a hash-routed SPA; the eventID and gdSport pair is
// exactly what the old site's Register buttons carried. gdSport=16 is fastpitch.
function usssaUrl(eventId: string): string {
  return `https://www.usssa.com/fastpitch/TournamentMain/#/?eventID=${eventId}&gdSport=16`;
}

// Parsed at noon UTC so a date-only string can't slip to the previous day in a
// negative-offset timezone, which is every timezone Island plays in.
function asDate(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

function fmt(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return asDate(iso).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

// "5" for a one-day event, "5-6" for a weekend, and "31-1" when the weekend
// crosses a month (Halloween into November). No spaces around the dash: at the
// date rail's width "14 - 15" ran the full 76px and started wrapping.
function dayLabel(e: IslandEvent): string {
  const start = fmt(e.start, { day: "numeric" });
  if (!e.end || e.end === e.start) return start;
  return `${start}-${fmt(e.end, { day: "numeric" })}`;
}

// "Sat & Sun" rather than a dash range, which read as a subtraction next to the
// numeric range directly above it.
function dowLabel(e: IslandEvent): string {
  const start = fmt(e.start, { weekday: "short" });
  if (!e.end || e.end === e.start) return start;
  return `${start} & ${fmt(e.end, { weekday: "short" })}`;
}

function monthKey(iso: string): string {
  return fmt(iso, { month: "long", year: "numeric" });
}

/* Inline SVG rather than emoji: emoji render differently on every platform and
   look like chat, not like a league site. */
function Icon({ path, size = 14 }: { path: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

const ICON_WHISTLE = "M12 3v4M5 21a4 4 0 0 1 0-8h6l8-3v8l-8-3";
const ICON_TROPHY = "M8 4h8v5a4 4 0 0 1-8 0zM5 4h3M16 4h3M12 13v4M9 21h6";
const ICON_BALL = "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M7 5c3 3 3 11 0 14M17 5c-3 3-3 11 0 14";
const ICON_STAR = "M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.4l6-.8z";
const ICON_ARROW = "M5 12h13M13 6l6 6-6 6";

const HL_ICONS = [ICON_WHISTLE, ICON_TROPHY, ICON_BALL, ICON_STAR];

export function IslandSlate() {
  const data = islandData as {
    season: string;
    intro: string;
    contact_email?: string;
    highlights?: { title: string; text: string }[];
    events: IslandEvent[];
  };

  const events = [...data.events].sort((a, b) => a.start.localeCompare(b.start));

  // Group into months in date order. A Map preserves insertion order, so the
  // months come out sorted because the events already are.
  const months = new Map<string, IslandEvent[]>();
  for (const e of events) {
    const key = monthKey(e.start);
    if (!months.has(key)) months.set(key, []);
    months.get(key)!.push(e);
  }

  return (
    <main className="container py-10">
      <header className="mb-6">
        {/* The header banner is word art reading "Tournaments", so Island's
            theme hides this visually (see data-banner-titled in
            island-theme.css). It stays in the markup so the page still has a
            real <h1> for screen readers and the document outline. */}
        <h1
          className="font-display"
          style={{
            fontSize: "clamp(40px, 6vw, 64px)",
            lineHeight: 0.95,
            color: "var(--text-strong)",
            margin: "0 0 10px",
          }}
        >
          {data.season} Tournaments
        </h1>
        <p className="ift-intro">{data.intro}</p>
      </header>

      {data.highlights && data.highlights.length > 0 && (
        <div className="ift-highlights">
          {data.highlights.map((h, i) => (
            <section key={h.title} className="ift-hl">
              <h2 className="ift-hl-title">
                <Icon path={HL_ICONS[i % HL_ICONS.length]!} />
                {h.title}
              </h2>
              <p className="ift-hl-text">{h.text}</p>
            </section>
          ))}
        </div>
      )}

      {[...months.entries()].map(([month, list]) => (
        <section key={month}>
          <div className="ift-month">
            <span className="ift-month-name">{month}</span>
          </div>

          <div className="ift-list">
            {list.map((e) => (
              <article key={`${e.name}-${e.start}`} className="ift-event">
                <div className="ift-date">
                  <span className="ift-date-mon">{fmt(e.start, { month: "short" })}</span>
                  <span className="ift-date-day">{dayLabel(e)}</span>
                  <span className="ift-date-dow">{dowLabel(e)}</span>
                </div>

                <div>
                  <h3 className="font-display ift-name">{e.name}</h3>
                  {e.subtitle && <p className="ift-sub">{e.subtitle}</p>}

                  <div className="ift-meta">
                    {e.ages && <span className="ift-chip">{e.ages}</span>}
                    {e.levels && <span className="ift-chip">{e.levels}</span>}
                    {e.guarantee && <span className="ift-chip">{e.guarantee}</span>}
                    {e.cost && (
                      <span className="ift-chip ift-chip-cost">
                        {e.cost} · umpire fees paid at the field
                      </span>
                    )}
                  </div>

                  {e.contact && <p className="ift-contact">Questions: {e.contact}</p>}
                </div>

                {e.usssa_event ? (
                  <a
                    className="ift-reg"
                    href={usssaUrl(e.usssa_event)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Register on USSSA
                    <Icon path={ICON_ARROW} size={15} />
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ))}

      {data.contact_email && (
        <p className="ift-foot">
          Registration and payment are handled by USSSA. For anything else about
          a tournament, email{" "}
          <a href={`mailto:${data.contact_email}`}>{data.contact_email}</a>.
        </p>
      )}
    </main>
  );
}

// "Tournament schedules are posted here every Tuesday night."
//
// Adam, 2026-09-06: "have to make it MUCH more noticable."
//
// The first version was a small line with a hairline left border and a
// rgba(0,0,0,0.03) tint. Island's tournaments page is pure BLACK, so a 3%
// black tint is invisible and the border was a whisker. It read as a caption
// on a page that is otherwise stadium lights and red word art. Styling for a
// light page and shipping to a dark one is the whole bug.
//
// So: a solid bar in the league's accent colour, sitting above the intro
// rather than under it, with the day of the week as its own line. It is the
// brightest thing on the page under the banner, which is the point.
//
// WORKS ON ANY TENANT'S PALETTE. The ink is the accent colour mixed down to
// 22% against black, so it is always a very dark version of the same hue and
// always high contrast on the accent behind it. Hard-coding a dark ink would
// break the first league whose accent is navy.

const ACCENT = "var(--brand-accent, #35afea)";
const INK = `color-mix(in srgb, ${ACCENT} 22%, #000)`;

export function ScheduleReleaseNote({ note }: { note?: string }) {
  if (!note) return null;
  return (
    <aside
      aria-label="When schedules are posted"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        margin: "0 0 24px",
        padding: "16px 20px",
        borderRadius: 14,
        background: ACCENT,
        color: INK,
        boxShadow: "0 6px 22px rgba(0,0,0,0.35)",
      }}
    >
      {/* SVG calendar, not an emoji (house style). */}
      <svg
        width="34"
        height="34"
        viewBox="0 0 24 24"
        fill="none"
        stroke={INK}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        style={{ flexShrink: 0 }}
      >
        <path d="M4 8h16M8 3v4M16 3v4M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" />
        <path d="M8 12h3v3H8z" />
      </svg>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            opacity: 0.75,
            marginBottom: 3,
          }}
        >
          Schedule release
        </div>
        <div
          style={{
            fontSize: "clamp(17px, 2.4vw, 22px)",
            fontWeight: 900,
            lineHeight: 1.25,
          }}
        >
          {note}
        </div>
      </div>
    </aside>
  );
}

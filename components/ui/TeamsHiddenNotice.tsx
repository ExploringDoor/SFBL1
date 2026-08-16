// What stands in for the team list while the field is still private.
//
// Mike asked for this (via Adam, 2026-08-14): the office sees who has
// registered, the public does not, until the league releases the schedule.
//
// Shared between the listing and each team's own page. Those are two separate
// routes and a team id is guessable and shareable, so hiding only the index
// would leave every team one URL away from public. One component so the two
// cannot drift into saying different things.
//
// This REPLACES the page rather than redirecting to it. redirect() looked
// tidier and does not work here: the layout (ticker, nav, footer) streams
// before the page body runs, so by the time the flag is checked the response
// has already begun and Next downgrades to a client-side redirect. curl saw a
// 200 with an empty body. Nothing leaked, but a page whose privacy depends on
// JavaScript running is not a page that is private.

import Link from "next/link";

export function TeamsHiddenNotice({
  registrationOpen,
}: {
  /** Only invite a signup while registration is actually taking them. */
  registrationOpen?: boolean;
}) {
  return (
    <main className="container py-10">
      <header className="mb-8">
        <h1
          className="font-display"
          style={{ fontSize: "clamp(34px, 5vw, 52px)" }}
        >
          <span style={{ color: "var(--text-strong)" }}>League</span>{" "}
          <span style={{ color: "var(--brand-primary)" }}>Teams</span>
        </h1>
      </header>
      <p
        style={{
          fontSize: 18,
          lineHeight: 1.6,
          maxWidth: "46ch",
          color: "var(--text-muted)",
        }}
      >
        The team list goes up when the schedule is released. Registration is
        open until then.
      </p>
      {registrationOpen && (
        <p style={{ marginTop: 20 }}>
          <Link
            href="/team-registration"
            className="le-cap-btn-primary"
            style={{
              display: "inline-block",
              padding: "12px 26px",
              background: "var(--brand-primary)",
              color: "#fff",
              borderRadius: 10,
              fontWeight: 800,
              letterSpacing: ".04em",
              textTransform: "uppercase",
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            Register your team
          </Link>
        </p>
      )}
    </main>
  );
}

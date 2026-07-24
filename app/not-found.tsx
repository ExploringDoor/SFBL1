// Custom 404. Renders when notFound() is called from a server
// component (e.g. /teams/[slug] for an unknown team) or for any
// route that doesn't exist.

import type { Metadata } from "next";
import Link from "next/link";

// Next returns this body with a 200 in some streaming paths (soft-404), so the
// robots tag — not the status code — is what actually keeps it out of search.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <main
      style={{
        maxWidth: 560,
        margin: "10vh auto",
        padding: "0 24px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        textAlign: "center",
      }}
    >
      {/* SVG, not an emoji (house style). */}
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "center" }}>
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 2a10 10 0 100 20 10 10 0 000-20zM4.5 7.5c2.6.6 4.6 2.6 5.2 5.2M19.5 7.5c-2.6.6-4.6 2.6-5.2 5.2M7.5 19.5c.6-2.6 2.6-4.6 5.2-5.2" />
        </svg>
      </div>
      <h1
        style={{
          fontSize: 28,
          fontWeight: 800,
          color: "#0f172a",
          margin: "0 0 12px",
        }}
      >
        Page not found
      </h1>
      <p
        style={{
          color: "#475569",
          fontSize: 15,
          lineHeight: 1.6,
          margin: "0 0 24px",
        }}
      >
        This page doesn't exist — maybe a typo in the URL, or a link
        from somewhere stale. Try the home page or pick a section
        from the nav.
      </p>
      <div
        style={{
          display: "flex",
          gap: 12,
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        <Link
          href="/"
          style={{
            padding: "10px 20px",
            background: "var(--brand-primary, #002d72)",
            color: "white",
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Home
        </Link>
        <Link
          href="/schedule"
          style={{
            padding: "10px 20px",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            color: "#334155",
            fontWeight: 700,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Schedule
        </Link>
        <Link
          href="/standings"
          style={{
            padding: "10px 20px",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            color: "#334155",
            fontWeight: 700,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Standings
        </Link>
      </div>
    </main>
  );
}

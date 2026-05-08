// Custom 404. Renders when notFound() is called from a server
// component (e.g. /teams/[slug] for an unknown team) or for any
// route that doesn't exist.

import Link from "next/link";

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
      <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 16 }}>
        ⚾
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

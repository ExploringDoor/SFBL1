// Offline fallback. The service worker (public/firebase-messaging-sw.js)
// caches this page on first visit and serves it whenever a navigation
// fetch fails — i.e. the user lost connectivity.
//
// Intentionally tiny + dependency-free so the cached HTML is small
// and the page works even when CSS / fonts haven't been cached yet.
// Inline styles (no Tailwind, no separate CSS file) so the offline
// experience never breaks because of a missing CSS bundle.

export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main
      style={{
        maxWidth: 480,
        margin: "10vh auto",
        padding: "0 24px",
        textAlign: "center",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#0f172a",
      }}
    >
      <div
        style={{
          fontSize: 64,
          lineHeight: 1,
          marginBottom: 16,
        }}
      >
        ⚾
      </div>
      <h1
        style={{
          fontSize: 28,
          fontWeight: 800,
          margin: "0 0 12px",
          letterSpacing: "-0.01em",
        }}
      >
        You're offline
      </h1>
      <p
        style={{
          color: "#475569",
          fontSize: 15,
          lineHeight: 1.6,
          margin: "0 0 24px",
        }}
      >
        We can't reach the league site right now. Check your connection
        and try again. Schedule and standings you've already viewed
        should still load from cache.
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
        <a
          href="/"
          style={{
            padding: "12px 24px",
            background: "var(--brand-primary, #002d72)",
            color: "white",
            borderRadius: 10,
            fontWeight: 700,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Try home page
        </a>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined") window.location.reload();
          }}
          style={{
            padding: "12px 24px",
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            color: "#334155",
            fontWeight: 700,
            fontSize: 14,
            background: "white",
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
      <p
        style={{
          marginTop: 32,
          fontSize: 12,
          color: "#94a3b8",
        }}
      >
        Tip: install this site to your home screen for the best offline
        experience.
      </p>
    </main>
  );
}

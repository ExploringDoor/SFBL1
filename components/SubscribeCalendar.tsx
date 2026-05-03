"use client";

// Calendar subscribe button — surfaces both the standard https URL and
// a webcal:// URL (which most calendar apps interpret as "subscribe").
// Clicking copies the URL or opens the appropriate handler.

import { useState } from "react";

export function SubscribeCalendar({ teamId }: { teamId?: string }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  function buildUrl(scheme: "https" | "webcal"): string {
    if (typeof window === "undefined") return "";
    const host = window.location.host;
    const path = "/api/schedule.ics" + (teamId ? `?team=${teamId}` : "");
    return `${scheme}://${host}${path}`;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(buildUrl("https"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard might be blocked — fall back to selecting the URL.
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-barlow"
        style={{
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--brand-primary)",
          background: "transparent",
          border: "1px solid var(--border)",
          padding: "8px 14px",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        📅 Subscribe to Calendar
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 6,
            zIndex: 20,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 14,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            minWidth: 300,
          }}
        >
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            Subscribing keeps your calendar in sync as games are added or moved.
          </p>
          <a
            href={buildUrl("webcal")}
            className="font-barlow"
            style={{
              display: "block",
              padding: "8px 12px",
              background: "var(--brand-primary)",
              color: "#fff",
              borderRadius: 6,
              textDecoration: "none",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textAlign: "center",
              marginBottom: 6,
            }}
          >
            Add to Apple / Outlook (webcal)
          </a>
          <a
            href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(buildUrl("webcal"))}`}
            target="_blank"
            rel="noreferrer"
            className="font-barlow"
            style={{
              display: "block",
              padding: "8px 12px",
              background: "var(--bg2)",
              color: "var(--text-strong)",
              borderRadius: 6,
              textDecoration: "none",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textAlign: "center",
              marginBottom: 10,
            }}
          >
            Add to Google Calendar
          </a>
          <button
            type="button"
            onClick={copy}
            className="font-barlow"
            style={{
              display: "block",
              width: "100%",
              padding: "6px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 11,
              color: "var(--muted)",
              cursor: "pointer",
            }}
          >
            {copied ? "URL copied!" : "Copy subscribe URL"}
          </button>
        </div>
      )}
    </div>
  );
}

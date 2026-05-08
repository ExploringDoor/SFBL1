"use client";

// Calendar subscribe controls. Two visible buttons (Google Calendar +
// Apple Calendar) instead of a dropdown — Adam asked for them to be
// obviously clickable rather than hidden behind a "subscribe" trigger.
//
// Two URL schemes for the SAME .ics feed:
//   - Apple / iCal / Outlook understand `webcal://` natively. Tapping
//     a webcal: link prompts the OS to subscribe.
//   - Google Calendar wants `https://...` passed as the `cid` query
//     param to its calendar.google.com/r endpoint.
//
// DVSL gotcha (commits 09f4c5b + 22 in our PWA brief): the Google
// deep-link only auto-subscribes for feeds Google already trusts.
// For Vercel-hosted .ics URLs the browser opens Google Calendar but
// the feed never gets added. The user has to manually paste the URL
// at calendar.google.com/r → +OtherCalendars → "From URL". So we
// also surface a Copy-URL button + show explicit instructions when
// they tap it, otherwise users stare at an empty Google Calendar
// wondering what happened.

import { useState } from "react";

export function SubscribeCalendar({ teamId }: { teamId?: string }) {
  const [copied, setCopied] = useState(false);

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
      setTimeout(() => setCopied(false), 4000);
    } catch {
      /* clipboard blocked — silent fail */
    }
  }

  return (
    <div className="le-cal-wrap">
      <span className="le-cal-eyebrow">Subscribe to schedule</span>
      <div className="le-cal-buttons">
        <a
          className="le-cal-btn le-cal-btn-google"
          // Google's cid param wants an https:// URL pointing at the
          // .ics — webcal:// reportedly works in Chrome but fails in
          // some browsers. https is the documented scheme.
          href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(
            buildUrl("https"),
          )}`}
          target="_blank"
          rel="noreferrer"
        >
          <span aria-hidden className="le-cal-icon">
            G
          </span>
          Google Calendar
        </a>
        <a
          className="le-cal-btn le-cal-btn-apple"
          href={buildUrl("webcal")}
        >
          <span aria-hidden className="le-cal-icon"></span>
          Apple Calendar
        </a>
        <button
          type="button"
          onClick={copy}
          className="le-cal-copy"
          title="Copy the .ics URL — paste into Google Calendar at calendar.google.com → + Other calendars → From URL"
        >
          {copied ? "✓ copied" : "Copy URL"}
        </button>
      </div>
      {copied && (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 12,
            color: "var(--muted)",
            lineHeight: 1.45,
          }}
        >
          On Google Calendar (desktop): click <strong>+ Other calendars</strong>{" "}
          → <strong>From URL</strong> → paste. The Android app doesn&rsquo;t
          have a "From URL" option, but once you add it on desktop it syncs
          to your phone.
        </p>
      )}
    </div>
  );
}

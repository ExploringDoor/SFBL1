"use client";

// Calendar subscribe controls. Two visible buttons (Google Calendar +
// Apple Calendar) instead of a dropdown — Adam asked for them to be
// obviously clickable rather than hidden behind a "subscribe" trigger.
//
// Apple/iCal/Outlook all understand `webcal://` — clicking the link
// triggers the OS's native "subscribe to calendar" prompt. Google
// Calendar needs a public https URL passed as a `cid` parameter.
// A copy-URL fallback is shown for users on neither platform.

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
      setTimeout(() => setCopied(false), 2000);
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
          href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(
            buildUrl("webcal"),
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
          title="Copy the .ics URL — works with any calendar app"
        >
          {copied ? "✓ copied" : "Copy URL"}
        </button>
      </div>
    </div>
  );
}

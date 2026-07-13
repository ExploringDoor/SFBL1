"use client";

// First-time captain welcome banner. Fires once on the first
// captain dashboard load and disappears forever after they click
// dismiss. Points them at the three things a captain actually does:
// roster, score submission, and team chat.
//
// Detection: localStorage flag `leagueplatform:cap-welcome-dismissed`
// — same persistence pattern as the iOS install tip. Doesn't
// require server state because the cost of showing it twice (e.g.
// captain on a new device) is low.

import { useEffect, useState } from "react";
import { useTenant } from "@/lib/tenant-context";
import { captainNoun } from "@/lib/tenants";

const DISMISSED_KEY = "leagueplatform:cap-welcome-dismissed";

export function FirstTimeWelcome({
  teamName,
}: {
  teamName: string;
}) {
  const { config } = useTenant();
  const captain = captainNoun(config);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const dismissed = window.localStorage.getItem(DISMISSED_KEY);
      if (!dismissed) setVisible(true);
    } catch {
      /* private browsing — show always, low harm */
    }
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  if (!visible) return null;

  return (
    <aside className="cap-welcome">
      <button
        type="button"
        onClick={dismiss}
        className="cap-welcome-close"
        aria-label="Dismiss welcome"
      >
        ×
      </button>
      <h3>Welcome, {captain}. 👋</h3>
      <p>
        You're now managing <strong>{teamName}</strong>. Here's what
        {captain}s do most often:
      </p>
      <ul>
        <li>
          <strong>Roster</strong> — add walk-ons, edit jersey numbers,
          confirm contact info.
        </li>
        <li>
          <strong>⚡ Quick Score</strong> — fastest way to log a final
          score after the game (no lineup needed).
        </li>
        <li>
          <strong>📡 Score Live</strong> — for the in-dugout
          scorekeeper. Taps update the public scoreboard in real time.
        </li>
        <li>
          <strong>📄 Upload scoresheet</strong> (in Submit Score) —
          drop a PDF / photo of your scorebook and the AI extracts
          batting stats automatically.
        </li>
      </ul>
      <p className="cap-welcome-foot">
        Questions? Check the <strong>Help</strong> tab or message the
        commissioner.
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="cap-welcome-cta"
      >
        Got it, thanks
      </button>

      <style jsx>{`
        .cap-welcome {
          position: relative;
          margin: 12px 28px 24px;
          padding: 24px 28px;
          background: linear-gradient(
            135deg,
            rgba(16, 185, 129, 0.08),
            rgba(59, 130, 246, 0.05)
          );
          border: 1px solid rgba(16, 185, 129, 0.3);
          border-radius: 14px;
        }
        .cap-welcome h3 {
          font-size: 18px;
          font-weight: 800;
          color: #0f172a;
          margin: 0 0 6px;
          letter-spacing: -0.01em;
        }
        .cap-welcome p {
          color: #475569;
          font-size: 14px;
          line-height: 1.55;
          margin: 0 0 12px;
        }
        .cap-welcome strong {
          color: #0f172a;
          font-weight: 600;
        }
        .cap-welcome ul {
          margin: 0 0 12px;
          padding-left: 20px;
          color: #475569;
          font-size: 14px;
          line-height: 1.7;
        }
        .cap-welcome-foot {
          font-size: 13px;
          color: #64748b;
          margin: 12px 0 14px;
        }
        .cap-welcome-close {
          position: absolute;
          top: 8px;
          right: 12px;
          width: 28px;
          height: 28px;
          background: transparent;
          border: none;
          font-size: 22px;
          color: #94a3b8;
          cursor: pointer;
          line-height: 1;
          font-family: inherit;
        }
        .cap-welcome-close:hover {
          color: #475569;
        }
        .cap-welcome-cta {
          background: var(--brand-primary, #002d72);
          color: white;
          border: none;
          padding: 10px 18px;
          border-radius: 8px;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
          font-family: inherit;
        }
        .cap-welcome-cta:hover {
          filter: brightness(1.1);
        }
      `}</style>
    </aside>
  );
}

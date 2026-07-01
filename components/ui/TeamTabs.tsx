"use client";

// Tabbed panels for the team detail page (stats-off leagues like COYBL):
// Schedule (the team's whole schedule) and Standings (its division). Each
// panel is server-rendered and passed in; this only toggles which shows.

import { useState, type ReactNode } from "react";

export interface TeamTab {
  id: string;
  label: string;
  panel: ReactNode;
}

export function TeamTabs({ tabs }: { tabs: TeamTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const sel = tabs.find((t) => t.id === active) ?? tabs[0];
  if (!sel) return null;

  return (
    <div>
      <div
        role="tablist"
        aria-label="Team sections"
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "2px solid var(--border)",
          marginBottom: 22,
        }}
      >
        {tabs.map((t) => {
          const on = t.id === sel.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActive(t.id)}
              className="font-barlow"
              style={{
                padding: "10px 18px",
                background: "none",
                border: "none",
                borderBottom:
                  "3px solid " + (on ? "var(--brand-primary)" : "transparent"),
                marginBottom: -2,
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 15,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: on ? "var(--brand-primary)" : "var(--muted)",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{sel.panel}</div>
    </div>
  );
}

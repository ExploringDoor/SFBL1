"use client";

// Rich rules renderer for tenants whose rules data is structured
// (array of {icon, section, items[]}) rather than freeform HTML.
// Layout matches LBDC's existing /rules surface:
//   - Top: 2 division tabs ("Saturday Division" / "Boomers 60/70")
//   - Below: a "Jump To" chip row with anchor links per section
//   - Then per-section cards with numbered items
//
// Section division-categorization is automatic:
//   - section title containing "Boomers" → boomers-only
//   - section "Pool Players" or "Protests" → both
//   - everything else → saturday-only
//
// Single-division leagues (e.g. SFBL) skip the tab and the
// jump-to row collapses to one set.

import { useState } from "react";

export interface RulesSection {
  icon?: string;
  section: string;
  items: string[];
}

type DivKey = "saturday" | "boomers";

function classifySection(title: string): Set<DivKey> {
  const t = title.toLowerCase();
  if (t.includes("boomers")) return new Set<DivKey>(["boomers"]);
  if (t.includes("pool player") || t.includes("protest")) {
    return new Set<DivKey>(["saturday", "boomers"]);
  }
  return new Set<DivKey>(["saturday"]);
}

function sectionAnchor(section: string): string {
  return section
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Strip the "Boomers 60/70 — " prefix on the boomers-tab labels —
// the tab itself already conveys the division, so the per-card
// header reads cleaner without it.
function cleanLabel(section: string, div: DivKey): string {
  if (div !== "boomers") return section;
  return section.replace(/^Boomers\s*60\/70\s*[—-]\s*/i, "").trim();
}

export function RulesRichView({
  sections,
  divisionsAvailable,
}: {
  sections: RulesSection[];
  divisionsAvailable: DivKey[];
}) {
  const initial: DivKey = divisionsAvailable[0] ?? "saturday";
  const [activeDiv, setActiveDiv] = useState<DivKey>(initial);

  const visible = sections.filter((s) =>
    classifySection(s.section).has(activeDiv),
  );

  const hasTabs = divisionsAvailable.length > 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* ── division tabs ── */}
      {hasTabs && (
        <div
          style={{
            background: "white",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 14,
            padding: 4,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 4,
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          {divisionsAvailable.map((d) => {
            const isActive = d === activeDiv;
            const label =
              d === "saturday" ? "SATURDAY DIVISION" : "BOOMERS RULES";
            const sub =
              d === "saturday" ? "Saturday League" : "60/70 Division";
            const dotColor = d === "saturday" ? "#fff" : "#7c3aed";
            return (
              <button
                key={d}
                type="button"
                onClick={() => setActiveDiv(d)}
                style={{
                  padding: "14px 18px",
                  borderRadius: 10,
                  background: isActive
                    ? "var(--brand-primary, #002d6e)"
                    : "transparent",
                  color: isActive ? "white" : "var(--text-strong)",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  textAlign: "left",
                  fontFamily: "inherit",
                  transition: "background 0.15s ease",
                }}
              >
                {d === "saturday" ? (
                  <span style={{ fontSize: 26 }} aria-hidden>
                    ⚾
                  </span>
                ) : (
                  <span
                    aria-hidden
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: isActive ? dotColor : "#7c3aed",
                      flexShrink: 0,
                    }}
                  />
                )}
                <span>
                  <span
                    className="font-display"
                    style={{
                      display: "block",
                      fontSize: 18,
                      fontWeight: 800,
                      letterSpacing: "0.02em",
                    }}
                  >
                    {label}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontSize: 12,
                      opacity: 0.7,
                      marginTop: 2,
                    }}
                  >
                    {sub}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── jump-to chip row ── */}
      {visible.length > 1 && (
        <div
          style={{
            background: "white",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 14,
            padding: "14px 18px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.16em",
              color: "var(--muted)",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Jump To
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {visible.map((s) => (
              <a
                key={s.section}
                href={`#${sectionAnchor(s.section)}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 14px",
                  background: "rgba(0,45,110,0.05)",
                  border: "1px solid rgba(0,45,110,0.18)",
                  borderRadius: 999,
                  color: "var(--brand-primary, #002d6e)",
                  fontSize: 13,
                  fontWeight: 700,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {s.icon && <span aria-hidden>{s.icon}</span>}
                {cleanLabel(s.section, activeDiv)}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── section cards ── */}
      {visible.map((s) => (
        <section
          key={s.section}
          id={sectionAnchor(s.section)}
          style={{
            background: "white",
            border: "1px solid rgba(0,0,0,0.08)",
            borderTop: "4px solid var(--brand-primary, #002d6e)",
            borderRadius: 14,
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            overflow: "hidden",
            scrollMarginTop: 80,
          }}
        >
          <header
            style={{
              padding: "16px 20px",
              borderBottom: "1px solid rgba(0,0,0,0.06)",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            {s.icon && (
              <span style={{ fontSize: 26 }} aria-hidden>
                {s.icon}
              </span>
            )}
            <h2
              className="font-display"
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.01em",
                color: "var(--text-strong)",
              }}
            >
              {cleanLabel(s.section, activeDiv)}
            </h2>
          </header>
          <ol
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
            }}
          >
            {s.items.map((item, i) => (
              <li
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "44px 1fr",
                  gap: 10,
                  padding: "14px 20px",
                  borderBottom:
                    i === s.items.length - 1
                      ? "none"
                      : "1px solid rgba(0,0,0,0.04)",
                  alignItems: "start",
                }}
              >
                <span
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--brand-primary, #002d6e)",
                    paddingTop: 3,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  style={{
                    fontSize: 15,
                    lineHeight: 1.55,
                    color: "var(--text-body)",
                  }}
                >
                  {item}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

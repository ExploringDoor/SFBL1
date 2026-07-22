"use client";

// Rich rules renderer for tenants whose rules data is structured
// (array of {icon, section, items[]}) rather than freeform HTML.
//
// TWO INPUT SHAPES, one renderer:
//
//   legacy (LBDC)   pass `divisionsAvailable`. Divisions are the fixed pair
//                   saturday/boomers and a section's division is inferred from
//                   its TITLE (see classifySection). Renders the original 2-up
//                   tab grid. Untouched on purpose: LBDC is live.
//
//   generic (Island) pass `divisions` — an ordered list of {key,label,sub}. A
//                   section declares its own membership via `section.divisions`;
//                   omitting it means "applies to every division". Renders a
//                   wrapping pill row, so it works for 4 divisions (10U..16/18U)
//                   where a hardcoded 2-column grid would not.
//
// Below the tabs both shapes render identically: a "Jump To" chip row, then
// per-section cards. A section with kind:"specs" renders its `specs` as a
// label/value stat grid instead of a numbered list — that's the at-a-glance
// strip (mound distance, ball size, game length) at the top of a division.
//
// WHY per-division tabs at all: Island's source rules page repeats the same
// block four times, once per division. Collapsing that into one shared list
// plus a comparison table is accurate but reads as though rules are missing.
// Here each tab carries a division's COMPLETE set, nothing to cross-reference.

import { useState } from "react";

export interface RulesSection {
  /** Legacy tenants pass an emoji here; generic tenants pass an ICONS key. */
  icon?: string;
  section: string;
  items?: string[];
  /** Generic mode: which division keys this section belongs to. Omit = all. */
  divisions?: string[];
  kind?: "specs";
  specs?: Array<{ label: string; value: string }>;
}

export interface DivisionDef {
  key: string;
  label: string;
  sub?: string;
}

type LegacyDivKey = "saturday" | "boomers";

// Legacy (LBDC) title-sniffing. Only reached when `divisions` is not passed.
function classifySection(title: string): Set<LegacyDivKey> {
  const t = title.toLowerCase();
  if (t.includes("boomers")) return new Set<LegacyDivKey>(["boomers"]);
  if (t.includes("pool player") || t.includes("protest")) {
    return new Set<LegacyDivKey>(["saturday", "boomers"]);
  }
  return new Set<LegacyDivKey>(["saturday"]);
}

function sectionAnchor(section: string): string {
  return section
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Strip the "Boomers 60/70 — " prefix on the boomers-tab labels — the tab
// itself already conveys the division. Legacy only.
function cleanLabel(section: string, divKey: string): string {
  if (divKey !== "boomers") return section;
  return section.replace(/^Boomers\s*60\/70\s*[—-]\s*/i, "").trim();
}

// ── icons ────────────────────────────────────────────────────────────────
// House style keeps emoji out of the UI, so generic tenants reference an icon
// by name and get an inline SVG. Legacy tenants stored literal emoji in `icon`;
// anything that isn't a known key is rendered as-is so LBDC is unaffected.
const ICON_PATHS: Record<string, string> = {
  ball: "M12 2a10 10 0 100 20 10 10 0 000-20zM4.5 7.5c2.6.6 4.6 2.6 5.2 5.2M19.5 7.5c-2.6.6-4.6 2.6-5.2 5.2M7.5 19.5c.6-2.6 2.6-4.6 5.2-5.2",
  clipboard:
    "M9 4h6v2H9zM7 4h2M15 4h2a2 2 0 012 2v13a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2M9 11h6M9 15h4",
  calendar: "M4 8h16M8 3v4M16 3v4M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z",
  warning: "M12 4l9 16H3l9-16zM12 10v4M12 17.5v.5",
  roster: "M4 6h10M4 12h10M4 18h7M18 8v8M14 12h8",
  trophy:
    "M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3M10 19h4M12 14v5M9 21h6",
  shield: "M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6l8-3z",
  book: "M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5zM19 17H6",
  star: "M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8L12 3z",
};

function Icon({ name, size = 22 }: { name?: string; size?: number }) {
  if (!name) return null;
  const d = ICON_PATHS[name];
  // Legacy emoji (or any unknown key) passes straight through unchanged.
  if (!d) {
    return (
      <span style={{ fontSize: size + 4 }} aria-hidden>
        {name}
      </span>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flexShrink: 0, color: "var(--brand-primary, #002d6e)" }}
    >
      <path d={d} />
    </svg>
  );
}

export function RulesRichView({
  sections,
  divisionsAvailable,
  divisions,
}: {
  sections: RulesSection[];
  /** Legacy (LBDC) mode. Ignored when `divisions` is provided. */
  divisionsAvailable?: LegacyDivKey[];
  /** Generic mode. Presence of this prop selects the data-driven path. */
  divisions?: DivisionDef[];
}) {
  const generic = Array.isArray(divisions) && divisions.length > 0;

  const divs: DivisionDef[] = generic
    ? divisions!
    : (divisionsAvailable ?? ["saturday"]).map((d) => ({
        key: d,
        label: d === "saturday" ? "SATURDAY DIVISION" : "BOOMERS RULES",
        sub: d === "saturday" ? "Saturday League" : "60/70 Division",
      }));

  const [activeDiv, setActiveDiv] = useState<string>(divs[0]?.key ?? "");

  const visible = sections.filter((s) =>
    generic
      ? !s.divisions || s.divisions.length === 0 || s.divisions.includes(activeDiv)
      : classifySection(s.section).has(activeDiv as LegacyDivKey),
  );

  const hasTabs = divs.length > 1;
  // Chip row lists real rule sections; the at-a-glance strip is already the
  // first thing on the page, so linking to it would just scroll to the top.
  const jumpTargets = visible.filter((s) => s.kind !== "specs");

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
            display: generic ? "flex" : "grid",
            ...(generic
              ? { flexWrap: "wrap" as const, gap: 4 }
              : { gridTemplateColumns: "1fr 1fr", gap: 4 }),
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          {divs.map((d) => {
            const isActive = d.key === activeDiv;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => setActiveDiv(d.key)}
                aria-pressed={isActive}
                style={{
                  padding: generic ? "10px 18px" : "14px 18px",
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
                  ...(generic ? { flex: "1 1 140px", minWidth: 120 } : {}),
                }}
              >
                {!generic &&
                  (d.key === "saturday" ? (
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
                        background: isActive ? "#fff" : "#7c3aed",
                        flexShrink: 0,
                      }}
                    />
                  ))}
                <span>
                  <span
                    className="font-display"
                    style={{
                      display: "block",
                      fontSize: generic ? 20 : 18,
                      fontWeight: 800,
                      letterSpacing: "0.02em",
                    }}
                  >
                    {d.label}
                  </span>
                  {d.sub && (
                    <span
                      style={{
                        display: "block",
                        fontSize: 12,
                        opacity: 0.7,
                        marginTop: 2,
                      }}
                    >
                      {d.sub}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── jump-to chip row ── */}
      {jumpTargets.length > 1 && (
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
            {jumpTargets.map((s) => (
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
                <Icon name={s.icon} size={15} />
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
            <Icon name={s.icon} size={24} />
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

          {s.kind === "specs" && s.specs?.length ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                // Grid lines are drawn as an inset shadow on each CELL rather
                // than as a tinted container showing through 1px gaps. With
                // auto-fit the last row rarely fills, and the container trick
                // painted that leftover space as a grey void.
                background: "white",
              }}
            >
              {s.specs.map((sp) => (
                <div
                  key={sp.label}
                  style={{
                    padding: "14px 18px",
                    boxShadow: "inset -1px -1px 0 rgba(0,0,0,0.06)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                      marginBottom: 6,
                    }}
                  >
                    {sp.label}
                  </div>
                  <div
                    className="font-display"
                    style={{
                      fontSize: 17,
                      fontWeight: 800,
                      lineHeight: 1.3,
                      color: "var(--text-strong)",
                    }}
                  >
                    {sp.value}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {(s.items ?? []).map((item, i) => (
                <li
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "44px 1fr",
                    gap: 10,
                    padding: "14px 20px",
                    borderBottom:
                      i === (s.items?.length ?? 0) - 1
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
          )}
        </section>
      ))}
    </div>
  );
}

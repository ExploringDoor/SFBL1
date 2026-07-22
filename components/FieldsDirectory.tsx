"use client";

// Client-side filtering + presentation for the /fields directory.
//
// Island plays at 52 fields across ~30 Long Island towns. As one flat
// alphabetical grid that is unusable at the field: a coach knows the town or
// half the name, and had to eyeball 52 cards to find it. This adds a single
// search box that matches name, town or street, a live count, and a town label
// on each card.
//
// Surface badges: their field names encode the surface inline ("Averill Park
// (Turf)", "Broadway Avenue (Dirt and Turf)"). Those are pulled out into a
// badge so the surface is scannable. Only parentheticals that actually name a
// surface are lifted — "Brennan Field (Lindenhurst Village Park)" is a location,
// not a surface, and stays in the name.
//
// Data-shape safe for the other tenants: SFBL/LBDC rows carry no parenthetical
// surface and their addresses parse the same way, so they get search and a town
// label and nothing else changes.

import { useMemo, useState } from "react";
import { sanitizeHtml } from "@/lib/markdown";

export interface Field {
  name: string;
  location?: string | null;
  address: string;
  mapsUrl?: string | null;
  appleMapsUrl?: string | null;
  notes?: string[];
  color?: string | null;
}

const SURFACE_RE = /\b(turf|dirt|grass)\b/i;

/** "Averill Park (Turf)" -> { name: "Averill Park", surface: "Turf" } */
function splitSurface(raw: string): { name: string; surface: string | null } {
  const m = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!m) return { name: raw, surface: null };
  const inner = m[2]!.trim();
  if (!SURFACE_RE.test(inner)) return { name: raw, surface: null };
  return { name: m[1]!.trim(), surface: inner };
}

/** Handles both "123 Main St, Shirley, NY 11967" and the SFBL style
 *  "18350 NW 67th Avenue, Miami Lakes FL 33015". */
function townOf(address: string): string {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[1]!;
  if (parts.length === 2) {
    return parts[1]!.replace(/\s+[A-Z]{2}\s+\d{5}(-\d{4})?$/, "").trim();
  }
  return "";
}

export function FieldsDirectory({ fields }: { fields: Field[] }) {
  const [q, setQ] = useState("");

  const rows = useMemo(
    () =>
      fields.map((f) => {
        const { name, surface } = splitSurface(f.name);
        const town = townOf(f.address);
        return {
          f,
          name,
          surface,
          town,
          hay: `${f.name} ${f.address}`.toLowerCase(),
        };
      }),
    [fields],
  );

  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => r.hay.includes(needle)) : rows;
  const townCount = new Set(rows.map((r) => r.town).filter(Boolean)).size;

  return (
    <>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <div style={{ position: "relative", flex: "1 1 320px", maxWidth: 420 }}>
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
            style={{
              position: "absolute",
              left: 13,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--muted)",
              pointerEvents: "none",
            }}
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a field or town"
            aria-label="Search fields by name or town"
            style={{
              width: "100%",
              padding: "11px 14px 11px 38px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.14)",
              background: "white",
              fontSize: 15,
              fontFamily: "inherit",
              color: "var(--text-strong)",
            }}
          />
        </div>
        <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>
          {needle
            ? `${shown.length} of ${rows.length} fields`
            : `${rows.length} fields across ${townCount} towns`}
        </span>
      </div>

      {shown.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>
          No field matches &ldquo;{q}&rdquo;.
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 14,
          }}
        >
          {shown.map(({ f, name, surface, town }) => {
            const accent = f.color ?? "var(--brand-primary)";
            const googleHref =
              f.mapsUrl ||
              `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(f.address)}`;
            const appleHref =
              f.appleMapsUrl ||
              `https://maps.apple.com/?q=${encodeURIComponent(f.address)}`;
            return (
              <li
                key={f.name}
                style={{
                  background: "white",
                  border: "1px solid rgba(0,0,0,0.08)",
                  borderLeft: `4px solid ${accent}`,
                  borderRadius: 12,
                  padding: "16px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <h3
                      className="font-display"
                      style={{
                        margin: 0,
                        fontSize: 18,
                        color: "var(--text-strong)",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {name}
                    </h3>
                    {surface && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          letterSpacing: "0.1em",
                          textTransform: "uppercase",
                          padding: "3px 8px",
                          borderRadius: 999,
                          background: "rgba(0,45,110,0.07)",
                          border: "1px solid rgba(0,45,110,0.18)",
                          color: "var(--brand-primary, #002d6e)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {surface}
                      </span>
                    )}
                    {f.location && (
                      <span style={{ fontSize: 13, color: "var(--muted)" }}>
                        {f.location}
                      </span>
                    )}
                  </div>
                  {town && (
                    <p
                      style={{
                        margin: "6px 0 0",
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "var(--brand-accent, #35afea)",
                      }}
                    >
                      {town}
                    </p>
                  )}
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: 13,
                      color: "var(--muted)",
                      lineHeight: 1.4,
                    }}
                  >
                    {f.address}
                  </p>
                </div>

                {Array.isArray(f.notes) && f.notes.length > 0 && (
                  <ul
                    style={{
                      listStyle: "disc",
                      paddingLeft: 18,
                      margin: 0,
                      color: "var(--text-body)",
                      fontSize: 13,
                      lineHeight: 1.55,
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                    }}
                  >
                    {f.notes.map((n, i) => (
                      // LBDC rows store inline <b><i> markup in notes.
                      <li
                        key={i}
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(n) }}
                      />
                    ))}
                  </ul>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <a
                    href={googleHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      flex: "1 1 130px",
                      textAlign: "center",
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "var(--brand-primary)",
                      color: "white",
                      textDecoration: "none",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    Google Maps
                  </a>
                  <a
                    href={appleHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      flex: "1 1 130px",
                      textAlign: "center",
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "rgba(0,0,0,0.06)",
                      color: "var(--text-strong)",
                      textDecoration: "none",
                      fontSize: 13,
                      fontWeight: 700,
                      border: "1px solid rgba(0,0,0,0.1)",
                    }}
                  >
                    Apple Maps
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

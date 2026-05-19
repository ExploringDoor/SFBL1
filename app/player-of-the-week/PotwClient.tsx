"use client";

// Interactive Player of the Week view: the spotlight + the
// season-grouped archive, where clicking any photo (or card) opens
// a lightbox with the BIG photo and the full write-up. The server
// page does the data load, date formatting, and HTML sanitization;
// this component only renders + handles the open/close interaction,
// so no sanitizer or Firestore code ships to the client.

import { useCallback, useEffect, useState } from "react";

export interface PotwCardItem {
  id: string;
  player_name: string;
  team_name: string;
  season: string;
  week_label: string;
  /** Pre-formatted on the server ("" when no date). */
  date_label: string;
  stat_line: string;
  /** Server-sanitized HTML ("" when no write-up). */
  blurb_html: string;
  /** "" when no photo. */
  photo_url: string;
}

interface Props {
  current: PotwCardItem | null;
  groups: { season: string; items: PotwCardItem[] }[];
}

export function PotwClient({ current, groups }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  // Flat lookup so the modal can resolve the clicked entry.
  const byId = new Map<string, PotwCardItem>();
  if (current) byId.set(current.id, current);
  for (const g of groups) for (const it of g.items) byId.set(it.id, it);
  const open = openId ? (byId.get(openId) ?? null) : null;

  const close = useCallback(() => setOpenId(null), []);

  // Esc to close + lock body scroll while the lightbox is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close]);

  return (
    <>
      {current && (
        <section
          style={{
            background: "white",
            border: "1px solid rgba(0,0,0,0.08)",
            borderTop: "5px solid var(--brand-primary)",
            borderRadius: 16,
            padding: "clamp(20px, 4vw, 36px)",
            display: "flex",
            gap: "clamp(16px, 4vw, 32px)",
            flexWrap: "wrap",
            alignItems: "flex-start",
          }}
        >
          {current.photo_url && (
            <button
              type="button"
              onClick={() => setOpenId(current.id)}
              aria-label={`Enlarge photo of ${current.player_name}`}
              style={{
                border: 0,
                padding: 0,
                background: "none",
                cursor: "zoom-in",
                flexShrink: 0,
                borderRadius: 14,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.photo_url}
                alt={current.player_name}
                style={{
                  width: "min(240px, 40vw)",
                  height: "min(240px, 40vw)",
                  objectFit: "cover",
                  borderRadius: 14,
                  display: "block",
                  background: "rgba(0,0,0,0.04)",
                }}
              />
            </button>
          )}
          <div style={{ flex: "1 1 280px", minWidth: 0 }}>
            <p
              className="sec-eyebrow"
              style={{ color: "var(--brand-primary)", margin: 0 }}
            >
              {/* Never a misleading "This Week" — the newest entry
                  may be a historical one (e.g. Spring 2019). Show
                  the real season/week/date it carries. */}
              {[current.season, current.week_label, current.date_label]
                .filter(Boolean)
                .join("  ·  ") || "Player of the Week"}
            </p>
            <h2
              className="font-display"
              style={{
                fontSize: "clamp(28px, 5vw, 44px)",
                lineHeight: 1.0,
                color: "var(--text-strong)",
                margin: "6px 0 0",
              }}
            >
              {current.player_name}
            </h2>
            {current.team_name && (
              <p
                style={{
                  margin: "6px 0 0",
                  color: "var(--muted)",
                  fontSize: 16,
                  fontWeight: 600,
                }}
              >
                {current.team_name}
              </p>
            )}
            {current.stat_line && (
              <p
                style={{
                  margin: "12px 0 0",
                  fontSize: 17,
                  fontWeight: 700,
                  color: "var(--brand-primary)",
                }}
              >
                {current.stat_line}
              </p>
            )}
            {current.blurb_html && (
              <div
                className="prose"
                style={{
                  marginTop: 14,
                  color: "var(--text-body)",
                  fontSize: 15,
                  lineHeight: 1.6,
                  maxWidth: 640,
                }}
                dangerouslySetInnerHTML={{ __html: current.blurb_html }}
              />
            )}
            {current.date_label && (
              <p
                style={{
                  marginTop: 14,
                  fontSize: 13,
                  color: "var(--muted)",
                }}
              >
                {current.date_label}
              </p>
            )}
          </div>
        </section>
      )}

      {groups.length > 0 && (
        <section style={{ marginTop: 40 }}>
          <h2
            className="font-display"
            style={{
              fontSize: 22,
              color: "var(--text-strong)",
              margin: "0 0 6px",
            }}
          >
            Past honorees
          </h2>
          <p
            style={{
              margin: "0 0 18px",
              fontSize: 13,
              color: "var(--muted)",
            }}
          >
            Tap any player to see their photo and full write-up.
          </p>
          {groups.map((g) => (
            <div key={g.season} style={{ marginBottom: 28 }}>
              <h3
                className="sec-eyebrow"
                style={{
                  color: "var(--brand-primary)",
                  margin: "0 0 10px",
                }}
              >
                {g.season}
              </h3>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 14,
                }}
              >
                {g.items.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setOpenId(e.id)}
                      aria-label={`See ${e.player_name}'s write-up`}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        background: "white",
                        border: "1px solid rgba(0,0,0,0.08)",
                        borderLeft: "4px solid var(--brand-primary)",
                        borderRadius: 12,
                        padding: "14px 16px",
                        display: "flex",
                        gap: 12,
                        alignItems: "flex-start",
                        cursor: "pointer",
                        font: "inherit",
                        color: "inherit",
                      }}
                    >
                      {e.photo_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={e.photo_url}
                          alt={e.player_name}
                          style={{
                            width: 56,
                            height: 56,
                            objectFit: "cover",
                            borderRadius: 8,
                            flexShrink: 0,
                            background: "rgba(0,0,0,0.04)",
                          }}
                        />
                      )}
                      <div style={{ minWidth: 0 }}>
                        {(e.week_label || e.date_label) && (
                          <p
                            style={{
                              margin: 0,
                              fontSize: 12,
                              color: "var(--muted)",
                              fontWeight: 600,
                            }}
                          >
                            {e.week_label || e.date_label}
                          </p>
                        )}
                        <h3
                          className="font-display"
                          style={{
                            margin: "2px 0 0",
                            fontSize: 18,
                            color: "var(--text-strong)",
                          }}
                        >
                          {e.player_name}
                        </h3>
                        {e.team_name && (
                          <p
                            style={{
                              margin: "2px 0 0",
                              fontSize: 13,
                              color: "var(--muted)",
                            }}
                          >
                            {e.team_name}
                          </p>
                        )}
                        {e.stat_line && (
                          <p
                            style={{
                              margin: "6px 0 0",
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--text-body)",
                            }}
                          >
                            {e.stat_line}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${open.player_name} — Player of the Week`}
          onClick={close}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.78)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "clamp(12px, 4vw, 40px)",
            overflowY: "auto",
          }}
        >
          <div
            onClick={(ev) => ev.stopPropagation()}
            style={{
              background: "white",
              borderRadius: 16,
              maxWidth: 720,
              width: "100%",
              maxHeight: "92vh",
              overflowY: "auto",
              position: "relative",
            }}
          >
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                width: 36,
                height: 36,
                borderRadius: "50%",
                border: 0,
                background: "rgba(0,0,0,0.55)",
                color: "white",
                fontSize: 20,
                lineHeight: "36px",
                cursor: "pointer",
                zIndex: 2,
              }}
            >
              ×
            </button>
            {open.photo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={open.photo_url}
                alt={open.player_name}
                style={{
                  width: "100%",
                  maxHeight: "62vh",
                  objectFit: "contain",
                  background: "#0c1322",
                  borderRadius: "16px 16px 0 0",
                  display: "block",
                }}
              />
            )}
            <div style={{ padding: "clamp(18px, 4vw, 30px)" }}>
              <p
                className="sec-eyebrow"
                style={{ color: "var(--brand-primary)", margin: 0 }}
              >
                {[open.season, open.week_label, open.date_label]
                  .filter(Boolean)
                  .join("  ·  ") || "Player of the Week"}
              </p>
              <h2
                className="font-display"
                style={{
                  fontSize: "clamp(26px, 5vw, 40px)",
                  lineHeight: 1.05,
                  color: "var(--text-strong)",
                  margin: "6px 0 0",
                }}
              >
                {open.player_name}
              </h2>
              {open.team_name && (
                <p
                  style={{
                    margin: "6px 0 0",
                    color: "var(--muted)",
                    fontSize: 16,
                    fontWeight: 600,
                  }}
                >
                  {open.team_name}
                </p>
              )}
              {open.stat_line && (
                <p
                  style={{
                    margin: "12px 0 0",
                    fontSize: 17,
                    fontWeight: 700,
                    color: "var(--brand-primary)",
                  }}
                >
                  {open.stat_line}
                </p>
              )}
              {open.blurb_html && (
                <div
                  className="prose"
                  style={{
                    marginTop: 14,
                    color: "var(--text-body)",
                    fontSize: 15.5,
                    lineHeight: 1.65,
                  }}
                  dangerouslySetInnerHTML={{ __html: open.blurb_html }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

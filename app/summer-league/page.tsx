// /summer-league — Island Fastpitch's USSSA-sanctioned Summer League standings.
//
// Island's own database holds the Spring/Summer league games it runs directly.
// The Summer League is run through USSSA, so its standings live on usssa.com
// (event 416133) behind a JavaScript app that renders one pool at a time.
//
// Rather than iframe that page (it carries USSSA's own ads and chrome, and would
// look broken inside this black layout) or hit their API (robots.txt disallows
// /api for every bot), this renders a SNAPSHOT read off the public Game Center
// pages, stored next to this file. Adam's call, 2026-07-29: show it natively now
// so Mike can see it, then refresh the file when the season ends Aug 15.
//
// The "as of" line and the mid-season banner are load-bearing — they keep the
// page honest about being a snapshot rather than a live feed.

import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { PublicLeagueConfig } from "@/lib/tenants";
import data from "./summer-usssa-2026.json";

export const dynamic = "force-dynamic";

const USSSA_EVENT_URL =
  "https://usssa.com/fastpitch/event_gameCenter/?divisionID=2747761";

export default function SummerLeaguePage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  // Island-only page: the JSON is their event. Any other tenant 404s rather
  // than rendering another league's standings under its own branding.
  if (tenantId !== "island") notFound();

  const config = (() => {
    const raw = h.get("x-tenant-config-json");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicLeagueConfig;
    } catch {
      return null;
    }
  })();

  const captured = new Date(data.captured_on + "T12:00:00").toLocaleDateString(
    "en-US",
    { year: "numeric", month: "long", day: "numeric" },
  );

  return (
    <main className="container py-10">
      <header style={{ marginBottom: 22 }}>
        <p className="sec-eyebrow" style={{ color: "var(--brand-primary)" }}>
          {config?.abbrev ?? "League"}
        </p>
        <h1
          className="font-display"
          style={{
            fontSize: "clamp(38px, 6vw, 60px)",
            lineHeight: 0.95,
            color: "var(--text-strong)",
            margin: 0,
          }}
        >
          Summer League
        </h1>
        <p style={{ marginTop: 10, color: "var(--muted)", maxWidth: 720, lineHeight: 1.6 }}>
          {data.event_name} runs through USSSA, {data.event_dates}. Standings
          below come from the USSSA event page.
        </p>
      </header>

      {!data.final && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
            border: "1px solid color-mix(in srgb, var(--brand-accent, #35afea) 40%, transparent)",
            background: "color-mix(in srgb, var(--brand-accent, #35afea) 12%, transparent)",
            borderRadius: 12,
            padding: "12px 16px",
            marginBottom: 20,
            fontSize: 14,
            color: "var(--text-body)",
          }}
        >
          <strong style={{ color: "var(--text-strong)" }}>
            Season in progress.
          </strong>
          <span>
            These standings are as of {captured} and will be updated when the
            season finishes on August 15.
          </span>
          <a
            href={USSSA_EVENT_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--brand-accent, #35afea)", fontWeight: 700 }}
          >
            View live on USSSA
          </a>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {data.groups.map((g) => (
          <section
            key={g.id}
            style={{
              background: "white",
              border: "1px solid rgba(0,0,0,0.08)",
              borderTop: "4px solid var(--brand-primary, #002d6e)",
              borderRadius: 14,
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              overflow: "hidden",
            }}
          >
            <header
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid rgba(0,0,0,0.06)",
                background:
                  "linear-gradient(180deg, color-mix(in srgb, var(--brand-primary, #002d6e) 6%, white), white)",
              }}
            >
              <h2
                className="font-display"
                style={{
                  margin: 0,
                  fontSize: 20,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  color: "var(--text-strong)",
                }}
              >
                {g.age} · {g.pool}
              </h2>
            </header>

            {/* Wide table on a phone has to scroll inside its own box rather
                than pushing the page sideways. */}
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 14,
                  minWidth: 560,
                }}
              >
                <thead>
                  <tr>
                    {["#", "Team", "Record", "Runs Allowed", "Run Diff", "USSSA Pts"].map(
                      (label, i) => (
                        <th
                          key={label}
                          style={{
                            textAlign: i <= 1 ? "left" : "right",
                            padding: "10px 14px",
                            fontSize: 11,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: "var(--muted)",
                            borderBottom: "1px solid rgba(0,0,0,0.08)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {g.teams.map((t) => (
                    <tr key={t.rank} style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                      <td style={{ padding: "11px 14px", color: "var(--muted)", width: 40 }}>
                        {t.rank}
                      </td>
                      <td style={{ padding: "11px 14px", fontWeight: 700 }}>
                        {t.name}{" "}
                        {/* USSSA's own class tag (12B, 14C...). Kept because it
                            explains why a 12U-class team appears in a 14U pool. */}
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: "0.06em",
                            color: "var(--muted)",
                            border: "1px solid rgba(0,0,0,0.14)",
                            borderRadius: 5,
                            padding: "1px 5px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {t.cls}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "11px 14px",
                          textAlign: "right",
                          fontWeight: 800,
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.record}
                      </td>
                      <td
                        style={{
                          padding: "11px 14px",
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          color: "var(--muted)",
                        }}
                      >
                        {t.avg_allow}
                      </td>
                      <td
                        style={{
                          padding: "11px 14px",
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          fontWeight: 700,
                          color: t.avg_diff.startsWith("-")
                            ? "var(--red, #c8102e)"
                            : "var(--green, #22c55e)",
                        }}
                      >
                        {t.avg_diff}
                      </td>
                      <td
                        style={{
                          padding: "11px 14px",
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          color: "var(--muted)",
                        }}
                      >
                        {t.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      <p style={{ marginTop: 22, fontSize: 13, color: "var(--muted)", lineHeight: 1.65 }}>
        Records, runs allowed and run differential are USSSA&rsquo;s own pool
        figures, taken from the{" "}
        <a
          href={USSSA_EVENT_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--brand-accent, #35afea)" }}
        >
          USSSA event page
        </a>{" "}
        on {captured}. 10U is not listed because USSSA has not released its
        schedule yet.
      </p>
    </main>
  );
}

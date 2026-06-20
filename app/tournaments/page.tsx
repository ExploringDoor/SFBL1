// Tournaments "front door". COYBL runs its tournaments on Five Tool, so this
// page frames them (charity) and links out to each SPECIFIC event. The list is
// data-driven from config.tournaments.events; it falls back to a single generic
// link when no events are configured. Shown in nav only when the tenant sets
// flags.show_tournaments.

import { headers } from "next/headers";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

const DEFAULT_TOURNAMENTS_URL = "https://play.fivetoolyouth.org";

export default function TournamentsPage() {
  const h = headers();
  const config = (() => {
    const raw = h.get("x-tenant-config-json");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicLeagueConfig;
    } catch {
      return null;
    }
  })();

  const fallbackUrl = config?.tournaments?.url ?? DEFAULT_TOURNAMENTS_URL;
  const events = config?.tournaments?.events ?? [];

  return (
    <main className="container py-10">
      {/* Charity-forward callout — COYBL's tournaments benefit Nationwide
          Children's Hospital. */}
      <div
        style={{
          border: "1px solid var(--border)",
          borderLeft: "5px solid var(--brand-accent, var(--brand-primary))",
          borderRadius: 12,
          background: "var(--card)",
          padding: "20px 22px",
          marginBottom: 24,
        }}
      >
        <h2
          className="font-display"
          style={{ fontSize: 24, marginBottom: 8, color: "var(--brand-primary)" }}
        >
          Playing for more than a trophy
        </h2>
        <p style={{ color: "var(--muted)", lineHeight: 1.6, fontSize: 15 }}>
          Our tournaments raise money for{" "}
          <strong style={{ color: "var(--text-strong)" }}>
            Nationwide Children&rsquo;s Hospital
          </strong>
          . Every team that plays helps kids and families battling pediatric
          illness — all proceeds go directly to the NCH Foundation.
        </p>
      </div>

      {events.length > 0 ? (
        <>
          <h2
            className="font-display"
            style={{ fontSize: 26, marginBottom: 4, color: "var(--text-strong)" }}
          >
            Our Tournaments
          </h2>
          <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 18, maxWidth: 640 }}>
            Registration, brackets, and schedules run on Five Tool. Pick a
            tournament to view details and sign your team up.
          </p>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            }}
          >
            {events.map((ev, i) => (
              <a
                key={`${ev.name}-${i}`}
                href={ev.url || fallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  background: "var(--card)",
                  padding: "16px 18px",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <span
                  className="font-display"
                  style={{ fontSize: 21, lineHeight: 1.15, color: "var(--brand-primary)" }}
                >
                  {ev.name}
                </span>

                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 4 }}>
                  {ev.when && <TournDetail icon="📅" text={ev.when} />}
                  {ev.location && <TournDetail icon="📍" text={ev.location} />}
                  {ev.cost && <TournDetail icon="💵" text={ev.cost} />}
                  {ev.ages && <TournDetail icon="🧢" text={ev.ages} />}
                </div>

                {ev.note && (
                  <span style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, marginTop: 4 }}>
                    {ev.note}
                  </span>
                )}

                <span
                  className="font-barlow"
                  style={{
                    marginTop: 8,
                    fontSize: 12.5,
                    fontWeight: 800,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: "var(--brand-accent, var(--brand-primary))",
                  }}
                >
                  View &amp; Register →
                </span>
              </a>
            ))}
          </div>

          <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 16 }}>
            Links open Five Tool in a new tab.
          </p>
        </>
      ) : (
        <>
          <p style={{ color: "var(--muted)", lineHeight: 1.6, fontSize: 15, maxWidth: 640, marginBottom: 24 }}>
            Registration, brackets, and schedules for our tournaments are hosted
            on our tournament platform. Click below to view upcoming events and
            sign your team up.
          </p>
          <a
            href={fallbackUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "14px 26px",
              borderRadius: 10,
              background: "var(--brand-primary)",
              color: "#fff",
              fontWeight: 800,
              fontSize: 16,
              letterSpacing: "0.02em",
              textDecoration: "none",
            }}
          >
            View Tournaments &amp; Register →
          </a>
          <p style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 14 }}>
            Opens our tournament platform in a new tab.
          </p>
        </>
      )}
    </main>
  );
}

function TournDetail({ icon, text }: { icon: string; text: string }) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        fontSize: 13.5,
        color: "var(--text-strong)",
      }}
    >
      <span aria-hidden style={{ fontSize: 13, opacity: 0.85, lineHeight: 1 }}>
        {icon}
      </span>
      <span>{text}</span>
    </span>
  );
}

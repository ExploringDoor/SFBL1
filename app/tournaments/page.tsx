// Tournaments "front door". For leagues that run their tournaments on an
// external platform (e.g. COYBL runs events on Five Tool), this page frames
// the tournaments and links out, rather than hosting registration here.
//
// Shown in nav only when the tenant sets flags.show_tournaments. The
// external URL + blurb are read from the tenant config when present, with
// a sensible default. TODO: make fully editable via page_content.

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
      return JSON.parse(raw) as PublicLeagueConfig & {
        tournaments?: { url?: string };
      };
    } catch {
      return null;
    }
  })();

  const url = config?.tournaments?.url ?? DEFAULT_TOURNAMENTS_URL;

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

      <p style={{ color: "var(--muted)", lineHeight: 1.6, fontSize: 15, maxWidth: 640, marginBottom: 24 }}>
        Registration, brackets, and schedules for our tournaments are hosted on
        our tournament platform. Click below to view upcoming events and sign
        your team up.
      </p>

      <a
        href={url}
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
    </main>
  );
}

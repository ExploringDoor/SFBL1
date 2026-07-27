// "Share this final" section for a game page/modal — Mike's ask: a one-tap
// downloadable graphic of a final so a parent can post their kid's game.
//
// Server component that builds the ShareCard's brand + game props from the
// tenant config and the loaded box-score data, then renders the client
// ShareCard (canvas + Download/Share). Used by BOTH the full game page and the
// intercepted modal route so the two never drift.
//
// Renders nothing unless the game is final with real scores. Team logos are the
// same-origin /island/teams/*.png paths, so the canvas isn't tainted.

import Link from "next/link";
import { headers } from "next/headers";
import ShareCard from "@/components/ui/ShareCard";
import { ShareGraphicReveal } from "@/components/ShareGraphicReveal";
import { initialsFromName } from "@/lib/team-initials";
import type { PublicLeagueConfig } from "@/lib/tenants";

interface ShareTeam {
  name: string;
  abbrev?: string;
  color?: string;
  logoUrl?: string | null;
  score: number;
}

export function GameShareSection({
  data,
  config,
}: {
  data: {
    status: string;
    date: string | null;
    field: string | null;
    home: ShareTeam;
    away: ShareTeam;
  };
  config: PublicLeagueConfig | null;
}) {
  const isFinal = data.status === "final" || data.status === "approved";
  if (
    !isFinal ||
    !Number.isFinite(data.home.score) ||
    !Number.isFinite(data.away.score)
  ) {
    return null;
  }

  const h = headers();
  const words = (config?.name ?? "League").trim().split(/\s+/);
  const theme = config?.theme;
  // Stats-off (COYBL): hide the graphic behind a "Share Graphic" button and
  // pair it with "View Standings", matching the LMLL modal. Other tenants keep
  // the graphic inline (Island's Mike wanted one-tap).
  const compact = config?.flags?.stats_enabled === false;

  const card = (
    <ShareCard
      game={{
        home: {
          name: data.home.name,
          // Badge from the name — COYBL's scraped abbrev is unreliable
          // (holds the record for some teams). See lib/team-initials.
          abbrev: initialsFromName(data.home.name),
          color: data.home.color,
          logo_url: data.home.logoUrl,
        },
        away: {
          name: data.away.name,
          abbrev: initialsFromName(data.away.name),
          color: data.away.color,
          logo_url: data.away.logoUrl,
        },
        home_score: data.home.score,
        away_score: data.away.score,
        date: data.date,
        division: null,
        field: data.field,
      }}
      brand={{
        line1: (words[0] ?? config?.abbrev ?? "").toUpperCase(),
        line2: words.slice(1).join(" ").toUpperCase(),
        primary: theme?.primary ?? "#0b2e4f",
        accent: theme?.accent ?? "#35afea",
        highlight: theme?.secondary ?? theme?.accent ?? "#c8dc2e",
        logoUrl: theme?.logo_url ?? null,
        siteUrl: h.get("x-forwarded-host") ?? h.get("host") ?? "",
        footerName: config?.name ?? "",
      }}
    />
  );

  if (compact) {
    return (
      <section className="no-print rc-actions" style={{ marginTop: 24 }}>
        <ShareGraphicReveal>{card}</ShareGraphicReveal>
        <Link href="/standings" className="rc-action rc-action-secondary">
          View Standings →
        </Link>
      </section>
    );
  }

  return (
    <section className="no-print" style={{ marginTop: 32 }}>
      <p
        className="sec-eyebrow"
        style={{ color: "var(--brand-primary)", marginBottom: 12 }}
      >
        Share this final
      </p>
      <div style={{ maxWidth: 420 }}>{card}</div>
    </section>
  );
}

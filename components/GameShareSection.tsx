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

import { headers } from "next/headers";
import ShareCard from "@/components/ui/ShareCard";
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

  return (
    <section className="no-print" style={{ marginTop: 32 }}>
      <p
        className="sec-eyebrow"
        style={{ color: "var(--brand-primary)", marginBottom: 12 }}
      >
        Share this final
      </p>
      <div style={{ maxWidth: 420 }}>
        <ShareCard
          game={{
            home: {
              name: data.home.name,
              abbrev: data.home.abbrev,
              color: data.home.color,
              logo_url: data.home.logoUrl,
            },
            away: {
              name: data.away.name,
              abbrev: data.away.abbrev,
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
      </div>
    </section>
  );
}

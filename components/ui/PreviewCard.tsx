"use client";

// Upcoming-game preview card — verbatim port of DVSL `.preview-card`
// (~/Desktop/softball-site/index.html JS template at lines 7887–7902).
//
// Compact card with no scores or buttons. Click anywhere → opens the
// game preview modal. The `isNext` flag marks the next upcoming game
// in the list with a navy left border.

import Link from "next/link";
import { useRouter } from "next/navigation";
import "./PreviewCard.css";

export interface PreviewCardTeam {
  team_id: string;
  name: string;
  abbrev?: string;
  logoUrl?: string | null;
  record?: string;
}

export interface PreviewCardProps {
  gameId: string;
  date: string | null;
  field?: string | null;
  away: PreviewCardTeam;
  home: PreviewCardTeam;
  /** Renders the navy left-border accent. */
  isNext?: boolean;
}

export function PreviewCard({
  gameId,
  date,
  field,
  away,
  home,
  isNext = false,
}: PreviewCardProps) {
  const timeLabel = formatTimeLabel(date, field);
  const router = useRouter();
  return (
    <div
      className={"le-preview-card" + (isNext ? " next" : "")}
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/games/${gameId}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/games/${gameId}`);
        }
      }}
    >
      <div className="le-preview-time">{timeLabel}</div>
      <div className="le-preview-teams">
        <Side team={away} />
        <Side team={home} />
      </div>
      <span className="le-preview-link">Preview »</span>
    </div>
  );
}

function Side({ team }: { team: PreviewCardTeam }) {
  return (
    <div className="le-preview-team-row">
      <div className="le-preview-logo">
        {team.logoUrl && <img src={team.logoUrl} alt="" />}
      </div>
      <div>
        <Link
          href={`/teams/${team.team_id}`}
          className="le-preview-name"
          onClick={(e) => e.stopPropagation()}
        >
          {team.name || team.abbrev}
        </Link>
        {team.record && (
          <span className="le-preview-rec">({team.record})</span>
        )}
      </div>
    </div>
  );
}

function formatTimeLabel(
  date: string | null,
  field: string | null | undefined,
): string {
  if (!date) return field ? `TBD · ${field}` : "TBD";
  const d = new Date(date);
  const day = d
    .toLocaleDateString("en-US", { weekday: "short" })
    .toUpperCase();
  const md = d.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return [`${day} ${md}`, time, field].filter(Boolean).join(" · ");
}

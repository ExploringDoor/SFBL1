"use client";

// Upcoming-game preview card — verbatim port of DVSL `.preview-card`
// (~/Desktop/softball-site/index.html JS template at lines 7887–7902).
//
// Compact card with no scores or buttons. Click anywhere → opens the
// game preview modal. The `isNext` flag marks the next upcoming game
// in the list with a navy left border.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseGameDate } from "@/lib/format-time";
import { shortFieldName } from "@/lib/field-label";
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
  /** When set (windmill homepage), the field label in the eyebrow becomes a
   *  link to the field directory (/fields?f=...) instead of plain text. */
  fieldHref?: string | null;
  away: PreviewCardTeam;
  home: PreviewCardTeam;
  /** Renders the navy left-border accent. */
  isNext?: boolean;
  /** Game status — used to show a non-default badge for postponed /
   *  cancelled games on the schedule view. Final games render via
   *  GameCard instead, so we don't expect "final" here. */
  status?: "scheduled" | "postponed" | "cancelled" | "final" | string;
  /** Age group ("9U") for age-grouped tenants — small pill so a mixed
   *  feed is readable. Omitted for flat leagues. */
  ageGroup?: string;
  /**
   * A rearranged game, rained out or moved and now replayed on a new date.
   *
   * Kaylee, 2026-09-06, asked for makeups to stand out on the schedule, and
   * she is right that they need to: a coach scanning for their next game reads
   * the date and stops, and a makeup is precisely the row where the date is
   * not the one they already wrote down.
   *
   * NOT a status. A makeup is scheduled, then it is final, exactly like every
   * other game; it is a fact ABOUT the fixture, not a state it passes through.
   * Making it a status would have meant a played makeup could not be "final".
   */
  makeup?: boolean;
}

export function PreviewCard({
  gameId,
  date,
  field,
  fieldHref,
  away,
  home,
  isNext = false,
  status,
  makeup,
  ageGroup,
}: PreviewCardProps) {
  // When the field is a link, keep it OUT of the joined time string so it can
  // render as its own <Link>; otherwise it stays inline plain text as before.
  const timeLabel = formatTimeLabel(date, fieldHref ? null : field);
  const router = useRouter();
  const badge = statusBadge(status);
  const muted =
    status === "cancelled" || status === "postponed" || status === "bye";
  return (
    <div
      className={
        "le-preview-card" +
        (isNext ? " next" : "") +
        (muted ? " muted" : "") +
        (makeup ? " is-makeup" : "")
      }
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
      <div className="le-preview-time">
        {timeLabel}
        {fieldHref && field && (
          <>
            {" · "}
            {/* stopPropagation so the field click opens the field directory
                instead of the card's game link. */}
            <Link
              href={fieldHref}
              className="le-preview-fieldlink"
              onClick={(e) => e.stopPropagation()}
            >
              {shortFieldName(field)}
            </Link>
          </>
        )}
        {ageGroup && (
          <span
            style={{
              display: "inline-block",
              marginLeft: 8,
              padding: "1px 8px",
              borderRadius: 999,
              background: "rgba(0,45,114,0.10)",
              color: "var(--brand-primary)",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.03em",
            }}
          >
            {ageGroup}
          </span>
        )}
        {/* MAKEUP, alongside any status rather than instead of it: a makeup
            can also be postponed, and hiding one behind the other loses the
            more urgent of the two. Colour AND a word, because colour alone is
            not a signal for a colourblind coach. */}
        {makeup && (
          <span className="le-preview-status" data-kind="makeup" aria-label="Makeup game">
            MAKEUP
          </span>
        )}
        {badge && (
          <span
            className="le-preview-status"
            data-kind={badge.kind}
            aria-label={badge.label}
          >
            {badge.label}
          </span>
        )}
      </div>
      <div className="le-preview-teams">
        <Side team={away} />
        <Side team={home} />
      </div>
      <span className="le-preview-link">Preview »</span>
    </div>
  );
}

function statusBadge(
  status: string | undefined,
): { kind: "postponed" | "cancelled" | "bye"; label: string } | null {
  if (status === "postponed") return { kind: "postponed", label: "POSTPONED" };
  if (status === "cancelled") return { kind: "cancelled", label: "CANCELLED" };
  if (status === "bye") return { kind: "bye", label: "BYE" };
  return null;
}

function Side({ team }: { team: PreviewCardTeam }) {
  return (
    <div className="le-preview-team-row">
      <div className="le-preview-logo">
        {team.logoUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={team.logoUrl} alt="" loading="lazy" decoding="async" />
        )}
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
  // TZ-safe parse so the calendar day matches on server + client (naive
  // new Date("YYYY-MM-DD") is UTC-midnight → day shift + hydration mismatch).
  const d = parseGameDate(date);
  if (!d) return field ? `TBD · ${field}` : "TBD";
  const day = d
    .toLocaleDateString("en-US", { weekday: "short" })
    .toUpperCase();
  const md = d.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
  });
  // Only show a clock when the date actually carries a time component —
  // otherwise a date-only game would read "12:00 AM".
  const time = /T\d{2}:\d{2}/.test(date)
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "";
  return [`${day} ${md}`, time, field].filter(Boolean).join(" · ");
}

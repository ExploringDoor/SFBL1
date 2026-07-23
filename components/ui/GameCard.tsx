"use client";

// Final-game card — verbatim port of DVSL `.gc-card`
// (~/Desktop/softball-site/index.html JS template at lines 7853–7881).
//
// Three rows: header (FINAL · date · headline), body (two team rows
// with logo/name/record/score), footer (Recap | Box Score buttons).
//
// HTML doesn't allow nested <a> tags. The card itself can't be a
// <Link> because team names and footer buttons inside the card are
// also <Link>s. Instead, the outer wrapper is a clickable <div> with
// an onClick that pushes the route. Inner Links use stopPropagation
// so clicking them overrides the card's own navigation.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatGameDate } from "@/lib/format-time";
import "./GameCard.css";

export interface GameCardTeam {
  team_id: string;
  name: string;
  abbrev?: string;
  color?: string;
  logoUrl?: string | null;
  /** Record like "5-2" or "8-3-1". */
  record?: string;
  score: number;
}

export interface GameCardProps {
  gameId: string;
  date: string | null;
  away: GameCardTeam;
  home: GameCardTeam;
  /** "FINAL" / "🔴 LIVE" — already formatted by caller. */
  statusLabel?: string;
  /** Optional headline like "WPBC WINS BIG, 12–3" or "SHARKS EDGE OUT". */
  headline?: string | null;
  /** Optional editorial badge — e.g. "🔥 NAIL-BITER", "⚾ BLOWOUT".
   *  Shown alongside the FINAL pill. Used by the scores page to call
   *  out the closest / biggest / highest-scoring game of the week. */
  badge?: { emoji: string; label: string } | null;
  /** Age group ("9U") for age-grouped tenants — shown as a small pill so
   *  a mixed feed is readable. Omitted for flat leagues. */
  ageGroup?: string;
  /** Compact/minimal card (COYBL / stats-off leagues). Header shows only
   *  "Final - <date>"; footer shows the age bracket on the left and a
   *  single Recap link on the right (no Box Score button, no headline,
   *  no editorial badge). Stats-off leagues have no box score to open, so
   *  the extra chrome is dropped. Non-compact leagues (SFBL) render the
   *  full card exactly as before. */
  compact?: boolean;
}

export function GameCard({
  gameId,
  date,
  away,
  home,
  statusLabel = "FINAL",
  headline,
  badge,
  ageGroup,
  compact = false,
}: GameCardProps) {
  const aWin = away.score > home.score;
  const hWin = home.score > away.score;
  // TZ-safe: parse as a local calendar day so the date matches on the server
  // and the client. Naive new Date("YYYY-MM-DD") is UTC-midnight, which shifts
  // a day in negative-offset zones and causes an SSR/hydration mismatch.
  const dateLabel =
    formatGameDate(date, undefined, { month: "short", day: "numeric" }) || null;
  const computedHeadline = headline ?? autoHeadline(away, home, aWin);
  const router = useRouter();

  return (
    <div
      className="le-gc-card"
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
      {compact ? (
        <div className="le-gc-card-hdr le-gc-hdr-compact">
          <span className="le-gc-status-compact">
            {(statusLabel === "FINAL" ? "Final" : statusLabel) +
              (dateLabel ? ` - ${dateLabel}` : "")}
          </span>
        </div>
      ) : (
        <div className="le-gc-card-hdr">
          <span className="le-gc-card-status">{statusLabel}</span>
          {ageGroup && (
            <span
              style={{
                display: "inline-block",
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
          {badge && (
            <span
              className="le-gc-card-badge"
              title={badge.label}
              aria-label={badge.label}
            >
              <span aria-hidden>{badge.emoji}</span>
              <span className="le-gc-card-badge-text">{badge.label}</span>
            </span>
          )}
          {dateLabel && <span className="le-gc-card-date">{dateLabel}</span>}
          {computedHeadline && (
            <span className="le-gc-card-headline">
              {computedHeadline.toUpperCase()}
            </span>
          )}
        </div>
      )}

      <div className="le-gc-card-body">
        <TeamRow team={away} winner={aWin} />
        <TeamRow team={home} winner={hWin} />
      </div>

      {compact ? (
        <div className="le-gc-card-footer le-gc-footer-compact">
          <span className="le-gc-age">{ageGroup ?? ""}</span>
          <Link
            href={`/games/${gameId}?tab=recap`}
            className="le-gc-btn"
            onClick={(e) => e.stopPropagation()}
          >
            Recap
          </Link>
        </div>
      ) : (
        <div className="le-gc-card-footer">
          <Link
            href={`/games/${gameId}?tab=recap`}
            className="le-gc-btn"
            onClick={(e) => e.stopPropagation()}
          >
            Recap
          </Link>
          <Link
            href={`/games/${gameId}`}
            className="le-gc-btn le-gc-btn-primary le-gc-btn-share"
            onClick={(e) => e.stopPropagation()}
          >
            Box Score
          </Link>
        </div>
      )}
    </div>
  );
}

function TeamRow({ team, winner }: { team: GameCardTeam; winner: boolean }) {
  return (
    <div className="le-gc-team-row">
      <div
        className={
          "le-gc-logo-wrap" + (team.logoUrl ? " le-gc-logo-wrap--img" : "")
        }
      >
        {team.logoUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={team.logoUrl}
            alt=""
            className="le-gc-logo-img"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span
            className="le-gc-logo-dot"
            style={{ background: team.color ?? "#9ca3af" }}
          />
        )}
      </div>
      <div className="le-gc-team-info">
        <Link
          href={`/teams/${team.team_id}`}
          className={"le-gc-team-name" + (!winner ? " le-gc-loser" : "")}
          onClick={(e) => e.stopPropagation()}
        >
          {team.name || team.abbrev}
        </Link>
        {team.record && <span className="le-gc-record">({team.record})</span>}
      </div>
      <div
        className={
          "le-gc-score " +
          (winner ? "le-gc-score-win" : "le-gc-score-lose")
        }
      >
        {team.score}
      </div>
    </div>
  );
}

function autoHeadline(
  away: GameCardTeam,
  home: GameCardTeam,
  awayWon: boolean,
): string {
  // Tie game gets its own line — saying "X edges out tie" reads as
  // a typo. Pick a real "tied at N" phrase instead.
  if (away.score === home.score) {
    return `Tied ${away.score}–${home.score}`;
  }
  const winner = awayWon ? away : home;
  const winnerScore = Math.max(away.score, home.score);
  const loserScore = Math.min(away.score, home.score);
  const diff = winnerScore - loserScore;
  const winnerLabel = winner.name || winner.abbrev || "";
  if (diff >= 10) {
    return `${winnerLabel} wins big, ${winnerScore}–${loserScore}`;
  }
  if (diff === 1) {
    return `${winnerLabel} edges out a close one`;
  }
  return `${winnerLabel} ${winnerScore}–${loserScore}`;
}

// DVSL-style game card. Three regions: header (status/date/headline),
// body (two team rows with logo+name+record+score), footer (Recap | Box
// Score buttons or Preview). Whole card is clickable; the footer
// buttons match DVSL's two-button pattern.

import Link from "next/link";
import { TeamBadge } from "./TeamBadge";

export interface GameCardTeam {
  team_id: string;
  name: string;
  abbrev?: string;
  color?: string;
  logoUrl?: string | null;
  record?: string;
}

export interface GameCardProps {
  id: string;
  date: string;
  field: string | null;
  status: string;
  away: GameCardTeam;
  home: GameCardTeam;
  awayScore?: number;
  homeScore?: number;
}

export function GameCard(props: GameCardProps) {
  const { id, date, field, status, away, home, awayScore, homeScore } = props;
  const isFinal = status === "final" || status === "approved";
  const dateLabel = formatHeaderDate(date);
  const time = formatTime(date);
  const headline = isFinal ? buildHeadline(away, home, awayScore, homeScore) : null;
  const awayWon = isFinal && awayScore != null && homeScore != null && awayScore > homeScore;
  const homeWon = isFinal && awayScore != null && homeScore != null && homeScore > awayScore;

  return (
    <article className="gc-card">
      <div className="gc-card-hdr">
        <span className="gc-card-status">
          {isFinal ? "Final" : status === "scheduled" ? time : status}
        </span>
        <span>{dateLabel}</span>
        {headline && <span className="gc-card-headline">{headline}</span>}
        {!isFinal && field && <span className="gc-card-headline">{field}</span>}
      </div>
      <div className="gc-card-body">
        <Row team={away} score={awayScore} isFinal={isFinal} winner={awayWon} />
        <Row team={home} score={homeScore} isFinal={isFinal} winner={homeWon} />
      </div>
      <div className="gc-card-footer">
        {isFinal ? (
          <>
            <Link href={`/games/${id}?tab=recap`} className="gc-btn">
              Recap
            </Link>
            <Link href={`/games/${id}`} className="gc-btn gc-btn-primary">
              Box Score
            </Link>
          </>
        ) : (
          <Link href={`/games/${id}`} className="gc-btn">
            Preview
          </Link>
        )}
      </div>
    </article>
  );
}

function Row({
  team,
  score,
  isFinal,
  winner,
}: {
  team: GameCardTeam;
  score: number | undefined;
  isFinal: boolean;
  winner: boolean;
}) {
  return (
    <div className="gc-team-row">
      <div className="gc-logo-wrap">
        <TeamBadge
          teamId={team.team_id}
          name={team.name}
          initials={team.abbrev}
          color={team.color}
          logoUrl={team.logoUrl}
          size="lg"
        />
      </div>
      <div className="gc-team-info">
        <span className="gc-team-name">{team.name}</span>
        {team.record && <span className="gc-record">{team.record}</span>}
      </div>
      {isFinal && score != null ? (
        <div className={"gc-score " + (winner ? "" : "gc-score-lose")}>{score}</div>
      ) : null}
    </div>
  );
}

function formatHeaderDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
function buildHeadline(
  away: GameCardTeam,
  home: GameCardTeam,
  awayScore?: number,
  homeScore?: number,
): string | null {
  if (awayScore == null || homeScore == null) return null;
  const winner = awayScore > homeScore ? away : home;
  const margin = Math.abs(awayScore - homeScore);
  const wAbbrev = winner.abbrev ?? winner.name.toUpperCase();
  if (margin >= 7) return `${wAbbrev} WINS BIG, ${Math.max(awayScore, homeScore)}–${Math.min(awayScore, homeScore)}`;
  if (margin === 0) return "TIE GAME";
  return `${wAbbrev} ${Math.max(awayScore, homeScore)}–${Math.min(awayScore, homeScore)}`;
}

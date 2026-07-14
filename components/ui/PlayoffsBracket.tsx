"use client";

// Classic single-elimination tournament BRACKET (PA D27 style, Nelson
// request 2026-07): round columns left→right, elbow connectors between
// them, a matchup card per game (seed · team · score, winner
// highlighted) with the game's date/field/time in the header, and a
// CHAMPION card at the end. Division tabs switch between brackets;
// the whole tree scrolls horizontally on phones.

import { Fragment, useState } from "react";
import Link from "next/link";

export interface BracketMatch {
  id: string;
  away_team_id: string | null;
  away_seed: number | null;
  home_team_id: string | null;
  home_seed: number | null;
  game_id: string | null;
  away_score: number | null;
  home_score: number | null;
  winner_team_id: string | null;
  status: "scheduled" | "live" | "final";
}
export interface BracketRound {
  label: string;
  matches: BracketMatch[];
}
export interface BracketDivision {
  label: string;
  rounds: BracketRound[];
}
export interface BracketGameInfo {
  dateLabel: string; // "Sun 7/19"
  timeLabel: string; // "9:30 AM"
  field: string | null;
}

export function PlayoffsBracket({
  divisions,
  teamName,
  gameInfo,
}: {
  divisions: BracketDivision[];
  teamName: Record<string, string>;
  gameInfo: Record<string, BracketGameInfo>;
}) {
  const [active, setActive] = useState(0);
  const div = divisions[Math.min(active, divisions.length - 1)];
  if (!div) return null;

  // Champion = winner of the final round's last decided match.
  const lastRound = div.rounds[div.rounds.length - 1];
  const finalMatch = lastRound?.matches[lastRound.matches.length - 1] ?? null;
  const championId =
    finalMatch && finalMatch.status === "final"
      ? finalMatch.winner_team_id
      : null;

  const label = (id: string | null) => (id ? teamName[id] ?? id : "TBD");

  return (
    <>
      {divisions.length > 1 && (
        <div className="bkt-tabs" role="tablist">
          {divisions.map((d, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === active}
              className={"bkt-tab" + (i === active ? " active" : "")}
              onClick={() => setActive(i)}
            >
              {d.label || `Division ${i + 1}`}
            </button>
          ))}
        </div>
      )}

      <div className="bkt-scroll">
        <div className="bkt-wrap">
          {div.rounds.map((round, ri) => (
            <Fragment key={ri}>
              <div className="bkt-col">
                <div className="bkt-col-label">
                  {round.label || `Round ${ri + 1}`}
                </div>
                <div className="bkt-col-body">
                  {round.matches.map((m) => (
                    <MatchCard
                      key={m.id}
                      match={m}
                      label={label}
                      info={m.game_id ? gameInfo[m.game_id] : undefined}
                    />
                  ))}
                </div>
              </div>

              {ri < div.rounds.length - 1 && (
                <div className="bkt-conn" aria-hidden>
                  <div className="bkt-conn-body">
                    {(div.rounds[ri + 1]?.matches ?? []).map((_, i) => (
                      <div key={i} className="bkt-elbow">
                        <span className="bkt-elbow-top" />
                        <span className="bkt-elbow-bot" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Fragment>
          ))}

          {championId && (
            <>
              <div className="bkt-conn bkt-conn-champ" aria-hidden>
                <div className="bkt-conn-body">
                  <div className="bkt-elbow bkt-elbow-flat">
                    <span className="bkt-elbow-mid" />
                  </div>
                </div>
              </div>
              <div className="bkt-col bkt-col-champ">
                <div className="bkt-col-label">Champion</div>
                <div className="bkt-col-body">
                  <div className="bkt-champ">
                    <span className="bkt-champ-trophy">🏆</span>
                    <span className="bkt-champ-name">{label(championId)}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function MatchCard({
  match,
  label,
  info,
}: {
  match: BracketMatch;
  label: (id: string | null) => string;
  info: BracketGameInfo | undefined;
}) {
  const isFinal = match.status === "final";
  const isLive = match.status === "live";
  const tbd = !match.away_team_id && !match.home_team_id;
  const awayWon = match.winner_team_id === match.away_team_id && !!match.winner_team_id;
  const homeWon = match.winner_team_id === match.home_team_id && !!match.winner_team_id;
  const showScore = isFinal || isLive || match.away_score != null || match.home_score != null;

  // Header: FINAL / LIVE / date · time · field (preview).
  const meta =
    info &&
    [info.dateLabel, info.timeLabel, info.field].filter(Boolean).join(" · ");

  const inner = (
    <article className={"bkt-match" + (tbd ? " tbd" : "") + (isLive ? " live" : "")}>
      <div className="bkt-match-hdr">
        <span className="bkt-match-badge">
          {isFinal ? "FINAL" : isLive ? "● LIVE" : "GAME"}
        </span>
        {meta && <span className="bkt-match-meta">{meta}</span>}
      </div>
      <TeamRow
        seed={match.away_seed}
        name={label(match.away_team_id)}
        score={match.away_score}
        won={awayWon}
        lost={isFinal && !awayWon && !!match.winner_team_id}
        showScore={showScore}
      />
      <TeamRow
        seed={match.home_seed}
        name={label(match.home_team_id)}
        score={match.home_score}
        won={homeWon}
        lost={isFinal && !homeWon && !!match.winner_team_id}
        showScore={showScore}
      />
    </article>
  );

  return match.game_id ? (
    <Link href={`/games/${match.game_id}`} className="bkt-match-link">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function TeamRow({
  seed,
  name,
  score,
  won,
  lost,
  showScore,
}: {
  seed: number | null;
  name: string;
  score: number | null;
  won: boolean;
  lost: boolean;
  showScore: boolean;
}) {
  return (
    <div className={"bkt-team" + (won ? " won" : "") + (lost ? " lost" : "")}>
      <span className="bkt-seed">{seed ? seed : ""}</span>
      <span className="bkt-team-name">{name}</span>
      {showScore && (
        <span className="bkt-score">{score != null ? score : "—"}</span>
      )}
    </div>
  );
}

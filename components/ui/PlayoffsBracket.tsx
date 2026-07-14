"use client";

// Playoff bracket — faithful port of the Small Town Selects / PA D27
// engine (Nelson, 2026-07): absolute-positioned cards + SVG connector
// lines that read like a printed bracket, rich cards (Game N + Winners
// badge, logo · seed · team · "via Gn" · score, winner in green, footer
// with date · time · field + Recap/Preview cue), and a gold champion
// banner. Single-elimination per division; each card links to its game.

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
  dateLabel: string; // "Sat, Jul 19"
  timeLabel: string; // "9:30 AM"
  field: string | null;
}

const CARD_W = 210;
const CARD_H = 132;
const COL_GAP = 76;
const ROW_GAP = 26;
const Y_PAD = 8;
const SLOT = CARD_H + ROW_GAP;

interface Placed {
  match: BracketMatch;
  gameNo: number;
  round: number;
  x: number;
  y: number;
  isFinal: boolean;
}

// Lay out one division's rounds as a single-elim tree: round 0 leaves
// evenly spaced, later-round games centered between their two feeders.
function layout(rounds: BracketRound[]): {
  placed: Placed[];
  paths: string[];
  width: number;
  height: number;
} {
  const gameNo = new Map<string, number>();
  let n = 1;
  rounds.forEach((r) => r.matches.forEach((m) => gameNo.set(m.id, n++)));

  const y = new Map<string, number>();
  const lastRound = rounds.length - 1;

  rounds.forEach((round, ri) => {
    round.matches.forEach((m, j) => {
      if (ri === 0) {
        y.set(m.id, Y_PAD + j * SLOT);
        return;
      }
      const prev = rounds[ri - 1]?.matches ?? [];
      const f1 = prev[2 * j];
      const f2 = prev[2 * j + 1];
      const y1 = f1 ? y.get(f1.id) : undefined;
      const y2 = f2 ? y.get(f2.id) : undefined;
      let yy: number;
      if (y1 != null && y2 != null) yy = (y1 + y2) / 2;
      else if (y1 != null) yy = y1;
      else yy = Y_PAD + j * SLOT;
      y.set(m.id, yy);
    });
    // de-overlap within the column
    const ys = round.matches
      .map((m) => ({ id: m.id, v: y.get(m.id) ?? 0 }))
      .sort((a, b) => a.v - b.v);
    for (let i = 1; i < ys.length; i++) {
      const prevItem = ys[i - 1]!;
      const cur = ys[i]!;
      const min = prevItem.v + SLOT;
      if (cur.v < min) {
        cur.v = min;
        y.set(cur.id, min);
      }
    }
  });

  const placed: Placed[] = [];
  rounds.forEach((round, ri) => {
    round.matches.forEach((m) => {
      placed.push({
        match: m,
        gameNo: gameNo.get(m.id) ?? 0,
        round: ri,
        x: ri * (CARD_W + COL_GAP),
        y: y.get(m.id) ?? Y_PAD,
        isFinal: ri === lastRound && rounds.length > 1,
      });
    });
  });

  // SVG connector paths: feeder right-mid → consumer left-mid (elbow).
  const paths: string[] = [];
  const byId = new Map(placed.map((p) => [p.match.id, p]));
  rounds.forEach((round, ri) => {
    if (ri === 0) return;
    const prev = rounds[ri - 1]?.matches ?? [];
    round.matches.forEach((m, j) => {
      const cons = byId.get(m.id);
      if (!cons) return;
      [prev[2 * j], prev[2 * j + 1]].forEach((f) => {
        if (!f) return;
        const fp = byId.get(f.id);
        if (!fp) return;
        const x1 = fp.x + CARD_W;
        const y1 = fp.y + CARD_H / 2;
        const x2 = cons.x;
        const y2 = cons.y + CARD_H / 2;
        const mx = x1 + (x2 - x1) / 2;
        paths.push(`M${x1},${y1} H${mx} V${y2} H${x2}`);
      });
    });
  });

  const width = Math.max(...placed.map((p) => p.x + CARD_W), CARD_W);
  const height = Math.max(...placed.map((p) => p.y + CARD_H), CARD_H) + Y_PAD;
  return { placed, paths, width, height };
}

export function PlayoffsBracket({
  divisions,
  teamName,
  teamLogo,
  gameInfo,
}: {
  divisions: BracketDivision[];
  teamName: Record<string, string>;
  teamLogo: Record<string, string | null>;
  gameInfo: Record<string, BracketGameInfo>;
}) {
  const [active, setActive] = useState(0);
  const div = divisions[Math.min(active, divisions.length - 1)];
  if (!div) return null;

  const { placed, paths, width, height } = layout(div.rounds);

  // Champion = winner of the final game (last round's single decided match).
  const lastRound = div.rounds[div.rounds.length - 1];
  const finalMatch =
    div.rounds.length > 1 ? lastRound?.matches[lastRound.matches.length - 1] : null;
  const championId =
    finalMatch && finalMatch.status === "final" ? finalMatch.winner_team_id : null;

  return (
    <>
      {divisions.length > 1 && (
        <div className="bk-tabs" role="tablist">
          {divisions.map((d, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === active}
              className={"bk-tab" + (i === active ? " active" : "")}
              onClick={() => setActive(i)}
            >
              {d.label || `Division ${i + 1}`}
            </button>
          ))}
        </div>
      )}

      {championId && (
        <div className="bk-champion">
          <span className="trophy" aria-hidden>
            🏆
          </span>
          <div className="ct">
            <div className="lbl">★ Champion ★</div>
            <div className="team">{teamName[championId] ?? championId}</div>
          </div>
          {teamLogo[championId] && (
            <img
              className="bk-champ-logo"
              src={teamLogo[championId] ?? ""}
              alt=""
            />
          )}
        </div>
      )}

      <div className="bk-scroll">
        <div
          className="bk-canvas"
          style={{ width: `${width}px`, height: `${height}px` }}
        >
          <svg width={width} height={height}>
            {paths.map((d, i) => (
              <path
                key={i}
                d={d}
                fill="none"
                stroke="rgba(20,20,30,.4)"
                strokeWidth={2}
              />
            ))}
          </svg>
          {placed.map((p) => (
            <MatchCard
              key={p.match.id}
              placed={p}
              teamName={teamName}
              teamLogo={teamLogo}
              info={p.match.game_id ? gameInfo[p.match.game_id] : undefined}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function MatchCard({
  placed,
  teamName,
  teamLogo,
  info,
}: {
  placed: Placed;
  teamName: Record<string, string>;
  teamLogo: Record<string, string | null>;
  info: BracketGameInfo | undefined;
}) {
  const { match: m, gameNo, isFinal, x, y } = placed;
  const played = m.status === "final";
  const aWin = played && m.winner_team_id === m.away_team_id && !!m.winner_team_id;
  const hWin = played && m.winner_team_id === m.home_team_id && !!m.winner_team_id;
  const showScore = played || m.status === "live";

  const when = played
    ? "Final" + (info?.dateLabel ? " · " + info.dateLabel : "")
    : [info?.dateLabel, info?.timeLabel].filter(Boolean).join(" · ") || "TBD";
  const field = info?.field ?? null;

  const card = (
    <div className={"bk-match acc-" + (isFinal ? "f" : "w")}>
      <div className="bk-mtop">
        <span className="g">Game {gameNo}</span>
        <span className={"tag " + (isFinal ? "f" : "w")}>
          {isFinal ? "🏆 Final" : "Winners"}
        </span>
      </div>
      <Side
        teamId={m.away_team_id}
        seed={m.away_seed}
        score={m.away_score}
        won={aWin}
        showScore={showScore}
        teamName={teamName}
        teamLogo={teamLogo}
      />
      <Side
        teamId={m.home_team_id}
        seed={m.home_seed}
        score={m.home_score}
        won={hWin}
        showScore={showScore}
        teamName={teamName}
        teamLogo={teamLogo}
      />
      <div className="bk-mfoot">
        <div className="bk-when">
          {played ? (
            <>
              <span className="fin">Final</span>
              {info?.dateLabel ? " · " + info.dateLabel : ""}
            </>
          ) : (
            when
          )}
        </div>
        <div className="bk-frow">
          <span className="bk-field">{field ? "📍 " + field : ""}</span>
          <span className="bk-cue">{played ? "Recap ›" : "Preview ›"}</span>
        </div>
      </div>
    </div>
  );

  const style = { left: `${x}px`, top: `${y}px` } as const;
  return m.game_id ? (
    <Link href={`/games/${m.game_id}`} className="bk-match-pos" style={style}>
      {card}
    </Link>
  ) : (
    <div className="bk-match-pos" style={style}>
      {card}
    </div>
  );
}

function Side({
  teamId,
  seed,
  score,
  won,
  showScore,
  teamName,
  teamLogo,
}: {
  teamId: string | null;
  seed: number | null;
  score: number | null;
  won: boolean;
  showScore: boolean;
  teamName: Record<string, string>;
  teamLogo: Record<string, string | null>;
}) {
  const tbd = !teamId;
  const name = teamId ? teamName[teamId] ?? teamId : "TBD";
  const logo = teamId ? teamLogo[teamId] : null;
  return (
    <div className={"bk-side" + (won ? " win" : "") + (tbd ? " tbd" : "")}>
      {logo ? (
        <img className="bk-logo" src={logo} alt="" />
      ) : (
        <span className="bk-logo bk-logo-blank" aria-hidden />
      )}
      <span className="nm">
        {seed ? <span className="bk-seed">{seed}</span> : null}
        {name}
      </span>
      <span className="sc">{showScore && score != null ? score : ""}</span>
    </div>
  );
}

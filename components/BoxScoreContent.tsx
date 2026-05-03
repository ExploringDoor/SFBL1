// Full DVSL-style box score: linescore + batting tables (per team) +
// pitching tables (per team) + recap block. Pure rendering — caller
// passes already-loaded data. Used by both the full /games/[id] page
// and the intercepted modal at @modal/(.)games/[id].

import Link from "next/link";
import { formatIP } from "@/lib/stats/ip";
import { buildRecap } from "@/lib/stats/recap";
import { TeamBadge } from "./TeamBadge";

export interface BoxBatter {
  player_id: string;
  ab?: number;
  r?: number;
  h?: number;
  doubles?: number;
  triples?: number;
  hr?: number;
  rbi?: number;
  bb?: number;
  so?: number;
  sb?: number;
}

export interface BoxPitcher {
  player_id: string;
  ip_outs?: number;
  h?: number;
  r?: number;
  er?: number;
  bb?: number;
  so?: number;
  hr?: number;
  decision?: "W" | "L" | "S";
}

export interface BoxTeam {
  team_id: string;
  name: string;
  abbrev?: string;
  color?: string;
  logoUrl?: string | null;
  score: number;
  linescore?: number[]; // runs by inning
  hits?: number;
  errors?: number;
  lineup: BoxBatter[];
  pitchers: BoxPitcher[];
}

export interface BoxScoreContentProps {
  gameId: string;
  date: string | null;
  field: string | null;
  status: string;
  innings: number;
  away: BoxTeam;
  home: BoxTeam;
  playerNames: Record<string, string>;
}

export function BoxScoreContent(props: BoxScoreContentProps) {
  const { date, field, status, innings, away, home, playerNames } = props;
  const isFinal = status === "final" || status === "approved";

  const recap = isFinal
    ? buildRecap({
        awayTeamName: away.name,
        homeTeamName: home.name,
        awayScore: away.score,
        homeScore: home.score,
        awayLineup: away.lineup,
        homeLineup: home.lineup,
        awayPitchers: away.pitchers,
        homePitchers: home.pitchers,
        playerNames,
      })
    : null;

  return (
    <div>
      <Header date={date} field={field} status={status} away={away} home={home} />
      {isFinal && (
        <Linescore innings={innings} away={away} home={home} />
      )}
      {recap && (
        <div className="bs-notes">
          <p>
            <strong>{recap.headline}</strong>
          </p>
          {recap.body.map((p, i) => (
            <p key={i} style={{ marginTop: 6 }}>
              {p}
            </p>
          ))}
          {recap.potg && (
            <p style={{ marginTop: 8 }}>
              <strong>Player of the Game:</strong>{" "}
              <Link href={`/players/${recap.potg.player_id}`}>
                {recap.potg.player_name}
              </Link>
            </p>
          )}
        </div>
      )}

      {away.lineup.length > 0 && (
        <BattingTable teamLabel={`${away.name} Batting`} rows={away.lineup} playerNames={playerNames} />
      )}
      {home.lineup.length > 0 && (
        <BattingTable teamLabel={`${home.name} Batting`} rows={home.lineup} playerNames={playerNames} />
      )}
      {away.pitchers.length > 0 && (
        <PitchingTable teamLabel={`${away.name} Pitching`} rows={away.pitchers} playerNames={playerNames} />
      )}
      {home.pitchers.length > 0 && (
        <PitchingTable teamLabel={`${home.name} Pitching`} rows={home.pitchers} playerNames={playerNames} />
      )}
    </div>
  );
}

function Header({
  date,
  field,
  status,
  away,
  home,
}: {
  date: string | null;
  field: string | null;
  status: string;
  away: BoxTeam;
  home: BoxTeam;
}) {
  const isFinal = status === "final" || status === "approved";
  const dateLabel = date
    ? new Date(date).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "TBD";
  return (
    <header style={{ borderBottom: "1px solid var(--border)", paddingBottom: 16, marginBottom: 18 }}>
      <p
        className="font-barlow"
        style={{
          fontSize: 11,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          color: "var(--muted)",
        }}
      >
        {[isFinal ? "Final" : status, dateLabel, field].filter(Boolean).join(" · ")}
      </p>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        <TeamLine team={away} score={isFinal ? away.score : null} winner={isFinal && away.score > home.score} />
        <TeamLine team={home} score={isFinal ? home.score : null} winner={isFinal && home.score > away.score} />
      </div>
    </header>
  );
}

function TeamLine({
  team,
  score,
  winner,
}: {
  team: BoxTeam;
  score: number | null;
  winner: boolean;
}) {
  return (
    <Link
      href={`/teams/${team.team_id}`}
      style={{ display: "flex", alignItems: "center", gap: 12 }}
    >
      <TeamBadge
        teamId={team.team_id}
        name={team.name}
        initials={team.abbrev}
        color={team.color}
        logoUrl={team.logoUrl}
        size="lg"
      />
      <div style={{ flex: 1 }}>
        <div
          className="font-oswald"
          style={{
            fontSize: 22,
            fontWeight: 700,
            textTransform: "uppercase",
            color: winner ? "var(--text-strong)" : "var(--muted)",
          }}
        >
          {team.name}
        </div>
      </div>
      {score != null && (
        <div
          className="font-barlow"
          style={{
            fontSize: 38,
            fontWeight: 900,
            color: winner ? "var(--text-strong)" : "rgba(0,0,0,0.38)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {score}
        </div>
      )}
    </Link>
  );
}

function Linescore({
  innings,
  away,
  home,
}: {
  innings: number;
  away: BoxTeam;
  home: BoxTeam;
}) {
  const inningsArray = Array.from({ length: innings }, (_, i) => i + 1);
  return (
    <table className="linescore-tbl">
      <thead>
        <tr>
          <th>Team</th>
          {inningsArray.map((i) => (
            <th key={i}>{i}</th>
          ))}
          <th>R</th>
          <th>H</th>
          <th>E</th>
        </tr>
      </thead>
      <tbody>
        <LinescoreRow team={away} innings={innings} />
        <LinescoreRow team={home} innings={innings} />
      </tbody>
    </table>
  );
}

function LinescoreRow({ team, innings }: { team: BoxTeam; innings: number }) {
  const linescore = team.linescore ?? Array(innings).fill(0);
  return (
    <tr>
      <td>{team.abbrev ?? team.name}</td>
      {Array.from({ length: innings }, (_, i) => (
        <td key={i}>{linescore[i] ?? "-"}</td>
      ))}
      <td>
        <b>{team.score}</b>
      </td>
      <td>
        <b>{team.hits ?? "-"}</b>
      </td>
      <td>
        <b>{team.errors ?? "-"}</b>
      </td>
    </tr>
  );
}

function BattingTable({
  teamLabel,
  rows,
  playerNames,
}: {
  teamLabel: string;
  rows: BoxBatter[];
  playerNames: Record<string, string>;
}) {
  const totals = rows.reduce(
    (acc, r) => ({
      ab: acc.ab + (r.ab ?? 0),
      r: acc.r + (r.r ?? 0),
      h: acc.h + (r.h ?? 0),
      doubles: acc.doubles + (r.doubles ?? 0),
      triples: acc.triples + (r.triples ?? 0),
      hr: acc.hr + (r.hr ?? 0),
      rbi: acc.rbi + (r.rbi ?? 0),
      bb: acc.bb + (r.bb ?? 0),
      so: acc.so + (r.so ?? 0),
    }),
    { ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0 },
  );
  return (
    <>
      <div className="modal-batting-hdr">
        <div className="modal-batting-title">{teamLabel}</div>
      </div>
      <div className="bat-tbl-wrap">
        <table className="bat-tbl">
          <thead>
            <tr>
              <th className="text-left">Player</th>
              <th>AB</th>
              <th>R</th>
              <th>H</th>
              <th>2B</th>
              <th>3B</th>
              <th>HR</th>
              <th>RBI</th>
              <th>BB</th>
              <th>K</th>
              <th>AVG</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ab = r.ab ?? 0;
              const h = r.h ?? 0;
              const avg = ab > 0 ? (h / ab).toFixed(3).replace(/^0/, "") : ".000";
              return (
                <tr key={r.player_id}>
                  <td className="text-left">
                    <Link href={`/players/${r.player_id}`} style={{ fontWeight: 600 }}>
                      {playerNames[r.player_id] ?? r.player_id}
                    </Link>
                  </td>
                  <td>{ab}</td>
                  <td>{r.r ?? 0}</td>
                  <td>{h}</td>
                  <td>{r.doubles ?? 0}</td>
                  <td>{r.triples ?? 0}</td>
                  <td>{r.hr ?? 0}</td>
                  <td>{r.rbi ?? 0}</td>
                  <td>{r.bb ?? 0}</td>
                  <td>{r.so ?? 0}</td>
                  <td>{avg}</td>
                </tr>
              );
            })}
            <tr className="totals-row">
              <td className="text-left">Totals</td>
              <td>{totals.ab}</td>
              <td>{totals.r}</td>
              <td>{totals.h}</td>
              <td>{totals.doubles}</td>
              <td>{totals.triples}</td>
              <td>{totals.hr}</td>
              <td>{totals.rbi}</td>
              <td>{totals.bb}</td>
              <td>{totals.so}</td>
              <td>—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function PitchingTable({
  teamLabel,
  rows,
  playerNames,
}: {
  teamLabel: string;
  rows: BoxPitcher[];
  playerNames: Record<string, string>;
}) {
  return (
    <>
      <div className="modal-batting-hdr">
        <div className="modal-batting-title">{teamLabel}</div>
      </div>
      <div className="bat-tbl-wrap">
        <table className="bat-tbl">
          <thead>
            <tr>
              <th className="text-left">Pitcher</th>
              <th>IP</th>
              <th>H</th>
              <th>R</th>
              <th>ER</th>
              <th>BB</th>
              <th>K</th>
              <th>HR</th>
              <th>ERA</th>
              <th>Dec</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const outs = p.ip_outs ?? 0;
              const er = p.er ?? 0;
              const era = outs > 0 ? ((er * 27) / outs).toFixed(2) : "—";
              return (
                <tr key={p.player_id}>
                  <td className="text-left">
                    <Link href={`/players/${p.player_id}`} style={{ fontWeight: 600 }}>
                      {playerNames[p.player_id] ?? p.player_id}
                    </Link>
                  </td>
                  <td>{formatIP(outs)}</td>
                  <td>{p.h ?? 0}</td>
                  <td>{p.r ?? 0}</td>
                  <td>{er}</td>
                  <td>{p.bb ?? 0}</td>
                  <td>{p.so ?? 0}</td>
                  <td>{p.hr ?? 0}</td>
                  <td>{era}</td>
                  <td>{p.decision ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

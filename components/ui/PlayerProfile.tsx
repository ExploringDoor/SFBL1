// Player profile body — verbatim port of DVSL `.modal-hero` +
// season tables (~/Desktop/softball-site/index.html lines 1019–1071).
//
// Drop-in body for both the full-page route at /players/[id] and
// the intercepted modal route at @modal/(.)players/[id]. Renders:
//
//   1. Hero — circular avatar, big Oswald name, position/team/number
//             meta line, and a horizontal stat pill (4 numbers).
//   2. Season batting table  (uses the global .bat-tbl CSS).
//   3. Season pitching table (only if pitching stats > 0).
//
// Uses the same .bat-tbl-wrap / .bat-tbl rules already in
// globals.css so the season + box-score tables look identical.

import Link from "next/link";
import { formatIP } from "@/lib/stats/ip";
import "./PlayerProfile.css";

export interface PlayerSeasonBatting {
  ab: number;
  r: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  sb?: number;
  /** Pre-computed avg/obp/slg/ops as decimal strings (".342", ".971", etc.). */
  avg: string;
  obp: string;
  slg: string;
  ops: string;
}

export interface PlayerSeasonPitching {
  ip_outs: number;
  h: number;
  r: number;
  er: number;
  bb: number;
  so: number;
  hr: number;
  /** Pre-computed era/whip as decimal strings. */
  era: string;
  whip: string;
  w?: number;
  l?: number;
  s?: number;
}

export interface PlayerProfileProps {
  playerId: string;
  name: string;
  number?: number | string | null;
  position?: string | null;
  team?: {
    team_id: string;
    name: string;
    abbrev?: string;
    color?: string;
    logoUrl?: string | null;
  } | null;
  /** Player's headshot, if any. Falls back to team logo, then initials. */
  photoUrl?: string | null;
  batting?: PlayerSeasonBatting | null;
  pitching?: PlayerSeasonPitching | null;
}

export function PlayerProfile({
  name,
  number,
  position,
  team,
  photoUrl,
  batting,
  pitching,
}: PlayerProfileProps) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // Avatar priority: player photo → team logo → initials.
  const avatarImg = photoUrl ?? team?.logoUrl ?? null;

  return (
    <div className="le-player-root">
      <div className="le-player-hero">
        <div
          className="le-player-av"
          style={team?.color ? { borderColor: team.color } : undefined}
        >
          {avatarImg ? <img src={avatarImg} alt="" /> : initials}
        </div>
        <div className="le-player-info">
          <h1 className="le-player-name">{name}</h1>
          <div className="le-player-meta">
            {number != null && number !== "" && (
              <span>
                <strong>#{number}</strong>
              </span>
            )}
            {position && (
              <span>
                <strong>{position}</strong>
              </span>
            )}
            {team && (
              <span>
                <Link href={`/teams/${team.team_id}`}>{team.name}</Link>
              </span>
            )}
          </div>
          {batting && <BattingPill batting={batting} />}
          {!batting && pitching && <PitchingPill pitching={pitching} />}
        </div>
      </div>

      <div className="le-player-section-label">Season Batting</div>
      {batting ? (
        <SeasonBattingTable batting={batting} />
      ) : (
        <div className="le-player-empty">No batting data this season.</div>
      )}

      {pitching && (
        <>
          <div className="le-player-section-label">Season Pitching</div>
          <SeasonPitchingTable pitching={pitching} />
        </>
      )}
    </div>
  );
}

function BattingPill({ batting }: { batting: PlayerSeasonBatting }) {
  return (
    <div className="le-msp">
      <PillCell value={batting.avg} label="AVG" />
      <span className="le-msp-sep" />
      <PillCell value={String(batting.hr)} label="HR" />
      <span className="le-msp-sep" />
      <PillCell value={String(batting.rbi)} label="RBI" />
      <span className="le-msp-sep" />
      <PillCell value={batting.ops} label="OPS" />
    </div>
  );
}

function PitchingPill({ pitching }: { pitching: PlayerSeasonPitching }) {
  return (
    <div className="le-msp">
      <PillCell value={formatIP(pitching.ip_outs)} label="IP" />
      <span className="le-msp-sep" />
      <PillCell value={pitching.era} label="ERA" />
      <span className="le-msp-sep" />
      <PillCell value={pitching.whip} label="WHIP" />
      <span className="le-msp-sep" />
      <PillCell value={String(pitching.so)} label="K" />
    </div>
  );
}

function PillCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="le-msp-item">
      <div className="le-msp-val">{value}</div>
      <div className="le-msp-lbl">{label}</div>
    </div>
  );
}

function SeasonBattingTable({ batting }: { batting: PlayerSeasonBatting }) {
  return (
    <div className="bat-tbl-wrap">
      <table className="bat-tbl">
        <thead>
          <tr>
            <th className="text-left">Season</th>
            <th>G</th>
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
            <th>OBP</th>
            <th>SLG</th>
            <th>OPS</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="text-left">2026</td>
            <td>—</td>
            <td>{batting.ab}</td>
            <td>{batting.r}</td>
            <td>{batting.h}</td>
            <td>{batting.doubles}</td>
            <td>{batting.triples}</td>
            <td>{batting.hr}</td>
            <td>{batting.rbi}</td>
            <td>{batting.bb}</td>
            <td>{batting.so}</td>
            <td>{batting.avg}</td>
            <td>{batting.obp}</td>
            <td>{batting.slg}</td>
            <td>{batting.ops}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SeasonPitchingTable({
  pitching,
}: {
  pitching: PlayerSeasonPitching;
}) {
  return (
    <div className="bat-tbl-wrap">
      <table className="bat-tbl">
        <thead>
          <tr>
            <th className="text-left">Season</th>
            <th>W</th>
            <th>L</th>
            <th>SV</th>
            <th>IP</th>
            <th>H</th>
            <th>R</th>
            <th>ER</th>
            <th>BB</th>
            <th>K</th>
            <th>HR</th>
            <th>ERA</th>
            <th>WHIP</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="text-left">2026</td>
            <td>{pitching.w ?? 0}</td>
            <td>{pitching.l ?? 0}</td>
            <td>{pitching.s ?? 0}</td>
            <td>{formatIP(pitching.ip_outs)}</td>
            <td>{pitching.h}</td>
            <td>{pitching.r}</td>
            <td>{pitching.er}</td>
            <td>{pitching.bb}</td>
            <td>{pitching.so}</td>
            <td>{pitching.hr}</td>
            <td>{pitching.era}</td>
            <td>{pitching.whip}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

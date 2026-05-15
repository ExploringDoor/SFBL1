// LBDC-style player profile body.
//
// Renders the "2026 Batting" → Regular Season / Projected / Career table,
// a Recent Games game log, and a "Career Pitching" per-season table —
// matching the layout LBDC's original site uses (see Adam's screenshot
// 2026-05-13).
//
// This component is purely presentational. The caller (the server
// page) pre-computes:
//   - currentBatting / careerBatting / projectedBatting / recentGames
//   - perSeasonPitching list (sorted by recency) + careerPitching total
// We don't fetch any data here.
//
// CSS lives in PlayerProfile.css alongside the original profile body
// (shared .bat-tbl / .le-player-section-label rules). Layout-specific
// rules added inline so it's clear what's new.

import Link from "next/link";
import { ProfileCloseButton } from "./ProfileCloseButton";

export interface BattingLine {
  gp: number;
  ab: number;
  r: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  sb: number;
  avg: number;
}

export interface PitchingLine {
  season: string; // display label, e.g. "Fall/Winter 2025-26"
  app: number;
  ip_outs: number;
  w: number;
  l: number;
  sv: number;
  era: number;
  whip: number;
  h: number;
  r: number;
  er: number;
  bb: number;
  so: number;
}

export interface RecentGame {
  gameId: string;
  date: string; // ISO
  opponentName: string;
  isHome: boolean;
  myScore: number;
  oppScore: number;
  result: "W" | "L" | "T";
  batting: {
    ab: number;
    r: number;
    h: number;
    doubles: number;
    triples: number;
    hr: number;
    rbi: number;
    bb: number;
    so: number;
    sb: number;
  } | null;
}

export interface PlayerProfileLBDCProps {
  name: string;
  team?: { team_id: string; name: string; color?: string } | null;
  currentSeasonLabel: string | null; // e.g. "2026"
  currentBatting: BattingLine | null;
  projectedBatting: BattingLine | null;
  careerBatting: BattingLine | null;
  recentGames: RecentGame[];
  pitchingBySeason: PitchingLine[];
  careerPitching: Omit<PitchingLine, "season"> | null;
  /** Show the navy-header "✕" button — wired to router.back() via
   *  ProfileCloseButton, which is a tiny client-only component.
   *  Only the intercepted modal route passes this; the full-page
   *  route omits it since there's no modal to close there. */
  showClose?: boolean;
}

export function PlayerProfileLBDC({
  name,
  team,
  currentSeasonLabel,
  currentBatting,
  projectedBatting,
  careerBatting,
  recentGames,
  pitchingBySeason,
  careerPitching,
  showClose,
}: PlayerProfileLBDCProps) {
  const accent = team?.color ?? "var(--brand-primary, #002d6e)";
  return (
    <div className="le-prof-lbdc">
      <header
        className="le-prof-head"
        style={{ background: accent }}
      >
        <h1>{name.toUpperCase()}</h1>
        {showClose && <ProfileCloseButton />}
      </header>

      {/* "{year} Batting" section */}
      {currentBatting && (
        <section className="le-prof-section">
          <div className="le-prof-section-head">
            <h2>{currentSeasonLabel ?? "Current"} Batting</h2>
            {/* "See All" link in the screenshot — points to /players
                for an at-a-glance comparison. */}
            <Link href="/players" className="le-prof-see-all">
              See All
            </Link>
          </div>
          <div className="le-prof-table-wrap">
            <table className="le-prof-table">
              <thead>
                <tr>
                  <th className="stats">STATS</th>
                  <th>GP</th>
                  <th>AB</th>
                  <th>R</th>
                  <th>H</th>
                  <th>2B</th>
                  <th>3B</th>
                  <th>HR</th>
                  <th>RBI</th>
                  <th>BB</th>
                  <th>SO</th>
                  <th>SB</th>
                  <th>AVG</th>
                </tr>
              </thead>
              <tbody>
                <BattingRow label="Regular Season" line={currentBatting} />
                {projectedBatting && (
                  <BattingRow
                    label="Projected"
                    line={projectedBatting}
                    italic
                    muted
                  />
                )}
              </tbody>
              {careerBatting && (
                <tfoot>
                  <BattingRow label="Career" line={careerBatting} bold />
                </tfoot>
              )}
            </table>
          </div>
        </section>
      )}

      {/* Career-only path — when the player hasn't played a current
          season game but has career stats. */}
      {!currentBatting && careerBatting && (
        <section className="le-prof-section">
          <div className="le-prof-section-head">
            <h2>Career Batting</h2>
          </div>
          <div className="le-prof-table-wrap">
            <table className="le-prof-table">
              <thead>
                <tr>
                  <th className="stats">STATS</th>
                  <th>GP</th>
                  <th>AB</th>
                  <th>R</th>
                  <th>H</th>
                  <th>2B</th>
                  <th>3B</th>
                  <th>HR</th>
                  <th>RBI</th>
                  <th>BB</th>
                  <th>SO</th>
                  <th>SB</th>
                  <th>AVG</th>
                </tr>
              </thead>
              <tbody>
                <BattingRow label="Career" line={careerBatting} bold />
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Recent Games */}
      {recentGames.length > 0 && (
        <section className="le-prof-section">
          <div className="le-prof-section-head">
            <h2>Recent Games</h2>
          </div>
          <div className="le-prof-table-wrap">
            <table className="le-prof-table">
              <thead>
                <tr>
                  <th className="stats">DATE</th>
                  <th className="opp">OPP</th>
                  <th>RESULT</th>
                  <th>AB</th>
                  <th>R</th>
                  <th>H</th>
                  <th>2B</th>
                  <th>3B</th>
                  <th>HR</th>
                  <th>RBI</th>
                  <th>BB</th>
                  <th>SO</th>
                  <th>SB</th>
                </tr>
              </thead>
              <tbody>
                {recentGames.map((g) => (
                  <RecentGameRow key={g.gameId} game={g} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Career Pitching */}
      {(pitchingBySeason.length > 0 || careerPitching) && (
        <section className="le-prof-section">
          <div className="le-prof-section-head">
            <h2>Career Pitching</h2>
          </div>
          <div className="le-prof-table-wrap">
            <table className="le-prof-table">
              <thead>
                <tr>
                  <th className="stats">SEASON</th>
                  <th>APP</th>
                  <th>IP</th>
                  <th>W</th>
                  <th>L</th>
                  <th>SV</th>
                  <th>ERA</th>
                  <th>WHIP</th>
                  <th>H</th>
                  <th>R</th>
                  <th>ER</th>
                  <th>BB</th>
                  <th>K</th>
                </tr>
              </thead>
              <tbody>
                {pitchingBySeason.map((p) => (
                  <PitchingRow key={p.season} line={p} />
                ))}
              </tbody>
              {/* Career footer hidden when there's only one season —
               *  in that case the season row IS the career total and
               *  the footer would just duplicate it. Same idea for
               *  zero seasons (only a career row, which we show
               *  alone via the no-seasons fallback below). */}
              {careerPitching && pitchingBySeason.length > 1 && (
                <tfoot>
                  <PitchingRow
                    line={{ ...careerPitching, season: "Career" }}
                    bold
                  />
                </tfoot>
              )}
              {/* Zero-season fallback: pitcher has career totals but
               *  no season_id-tagged box scores (SFBL pre-schema-
               *  change boxes). Render the career row as the only
               *  body row so the table isn't empty. */}
              {careerPitching && pitchingBySeason.length === 0 && (
                <tbody>
                  <PitchingRow
                    line={{ ...careerPitching, season: "Career" }}
                    bold
                  />
                </tbody>
              )}
            </table>
          </div>
        </section>
      )}

      <p className="le-prof-footnote">
        Stats sourced from recorded box scores only. Games without
        entered stats are not reflected.
      </p>
    </div>
  );
}

function BattingRow({
  label,
  line,
  italic,
  muted,
  bold,
}: {
  label: string;
  line: BattingLine;
  italic?: boolean;
  muted?: boolean;
  bold?: boolean;
}) {
  const style: React.CSSProperties = {
    fontStyle: italic ? "italic" : undefined,
    color: muted ? "var(--muted, #94a3b8)" : undefined,
    fontWeight: bold ? 800 : undefined,
  };
  return (
    <tr style={style}>
      <td className="stats">{label}</td>
      <td>{line.gp}</td>
      <td>{line.ab}</td>
      <td>{line.r}</td>
      <td>{line.h}</td>
      <td>{line.doubles}</td>
      <td>{line.triples}</td>
      <td>{line.hr}</td>
      <td>{line.rbi}</td>
      <td>{line.bb}</td>
      <td>{line.so}</td>
      <td>{line.sb}</td>
      <td className="hl">{formatAvg(line.avg)}</td>
    </tr>
  );
}

function RecentGameRow({ game }: { game: RecentGame }) {
  const date = formatShortDate(game.date);
  const resultColor =
    game.result === "W"
      ? "#16a34a"
      : game.result === "L"
        ? "#dc2626"
        : "#64748b";
  const b = game.batting;
  return (
    <tr>
      <td className="stats">{date}</td>
      <td className="opp">
        {(game.isHome ? "" : "@ ") + game.opponentName}
      </td>
      <td style={{ color: resultColor, fontWeight: 700 }}>
        {game.result} {game.myScore}-{game.oppScore}
      </td>
      <td>{b?.ab ?? "—"}</td>
      <td>{b?.r ?? "—"}</td>
      <td>{b?.h ?? "—"}</td>
      <td>{b?.doubles ?? "—"}</td>
      <td>{b?.triples ?? "—"}</td>
      <td>{b?.hr ?? "—"}</td>
      <td>{b?.rbi ?? "—"}</td>
      <td>{b?.bb ?? "—"}</td>
      <td>{b?.so ?? "—"}</td>
      <td>{b?.sb ?? "—"}</td>
    </tr>
  );
}

function PitchingRow({ line, bold }: { line: PitchingLine; bold?: boolean }) {
  return (
    <tr style={bold ? { fontWeight: 800 } : undefined}>
      <td className="stats">{line.season}</td>
      <td>{line.app}</td>
      <td>{formatIP(line.ip_outs)}</td>
      <td style={line.w > 0 ? { color: "#16a34a", fontWeight: 700 } : undefined}>
        {line.w}
      </td>
      <td style={line.l > 0 ? { color: "#dc2626", fontWeight: 700 } : undefined}>
        {line.l}
      </td>
      <td>{line.sv}</td>
      <td className="hl">{line.era.toFixed(2)}</td>
      <td>{line.whip.toFixed(2)}</td>
      <td>{line.h}</td>
      <td>{line.r}</td>
      <td>{line.er}</td>
      <td>{line.bb}</td>
      <td>{line.so}</td>
    </tr>
  );
}

function formatAvg(n: number): string {
  if (n === 1) return "1.000";
  return n.toFixed(3).replace(/^0/, "");
}

// "5.2" baseball IP (5 innings + 2 outs). Inlined here to avoid a
// server-only stats lib import.
function formatIP(outs: number): string {
  const innings = Math.floor(outs / 3);
  const partial = outs % 3;
  return `${innings}.${partial}`;
}

function formatShortDate(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

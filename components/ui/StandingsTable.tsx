// Standings — verbatim port of DVSL `.div-card` + `.s-tbl`
// (~/Desktop/softball-site/index.html lines 845–863).
//
// One card per division. Header strip with division label, then the
// table. Top-row gets `.leader` so its team name turns brand-primary.
//
// Two variants:
//   • "full"    — homepage-of-standings: all columns (PCT GB RS RA DIFF STRK)
//   • "compact" — homepage sidebar: just W L PCT STRK
//
// The component takes pre-computed rows (server already ran
// computeStandings + grouped by division). It only renders.

import Link from "next/link";
import {
  computePoints,
  type PointsScheme,
  type StandingsRow,
} from "@/lib/stats/shared";
import "./StandingsTable.css";

export interface TeamMeta {
  name: string;
  abbrev?: string;
  color?: string;
  logoUrl?: string | null;
  division?: string;
}

export interface DivisionGroup {
  division: string | null;
  rows: StandingsRow[];
}

export interface StandingsTableProps {
  groups: DivisionGroup[];
  teamMeta: Record<string, TeamMeta>;
  pointsScheme?: PointsScheme | null;
  variant?: "full" | "compact";
  /** Show STRK + RS/RA/DIFF columns. Default true on the full
   *  standings page; pass false on the homepage to keep the sidebar
   *  to W L T PTS PCT GB only. */
  showExtras?: boolean;
}

export function StandingsTable({
  groups,
  teamMeta,
  pointsScheme = null,
  variant = "full",
  showExtras = true,
}: StandingsTableProps) {
  const multi = groups.length > 1;
  // Hide T / RS / RA / DIFF columns unless someone actually has data
  // for them — keeps the standings table looking clean when ties are
  // unused (the common case).
  const allRows = groups.flatMap((g) => g.rows);
  const anyTies = allRows.some((r) => r.t > 0);
  const showRunsCols = variant === "full" && showExtras;
  const showStreak = showExtras;

  // Compact mode (homepage sidebar) renders as a list, not a table —
  // tables kept overflowing the 340px column at any reasonable font
  // size. The list-style row is bullet-proof: rank | abbrev | record
  // | streak, each piece flex-shrink-controlled.
  if (variant === "compact") {
    return (
      <div className={"le-standings-wrap" + (multi ? " le-multi" : "")}>
        {groups.map(({ division, rows }) => (
          <div key={division ?? "league"} className="le-div-card">
            {division && (
              <div className="le-div-card-head">
                <span className="le-div-card-label">{division}</span>
              </div>
            )}
            <ul className="le-compact-list">
              {rows.map((r, i) => {
                const meta = teamMeta[r.team_id];
                const recordStr = anyTies && r.t > 0
                  ? `${r.w}-${r.l}-${r.t}`
                  : `${r.w}-${r.l}`;
                return (
                  <Link
                    key={r.team_id}
                    href={`/teams/${r.team_id}`}
                    className={"le-compact-row" + (i === 0 ? " leader" : "")}
                  >
                    <span className="le-compact-rank">{i + 1}</span>
                    <span className="le-compact-name">
                      {meta?.abbrev ?? meta?.name ?? r.team_id}
                    </span>
                    <span className="le-compact-rec">{recordStr}</span>
                    <span
                      className={
                        "le-compact-streak " +
                        (r.streak ? streakClass(r.streak) : "")
                      }
                    >
                      {r.streak ?? "-"}
                    </span>
                  </Link>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className={
        "le-standings-wrap" +
        (multi ? " le-multi" : "") +
        (variant === "full" ? " le-full" : "")
      }
    >
      {groups.map(({ division, rows }) => (
        <div key={division ?? "league"} className="le-div-card">
          {division && (
            <div className="le-div-card-head">
              <span className="le-div-card-label">{division}</span>
            </div>
          )}
          <table className="le-s-tbl">
            <thead>
              <tr>
                <th>Team</th>
                <th>W</th>
                <th>L</th>
                {anyTies && <th>T</th>}
                {pointsScheme && <th>PTS</th>}
                <th>PCT</th>
                <th>GB</th>
                {showRunsCols && (
                  <>
                    <th>RS</th>
                    <th>RA</th>
                    <th>DIFF</th>
                  </>
                )}
                {showStreak && <th>STRK</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const meta = teamMeta[r.team_id];
                return (
                  <tr key={r.team_id} className={i === 0 ? "leader" : ""}>
                    <td>
                      <span className="le-team-cell">
                        {/* Compact sidebar drops the logo to save space.
                            Full standings page keeps it. */}
                        {meta?.logoUrl && (
                          <span className="le-team-logo">
                            <img src={meta.logoUrl} alt="" />
                          </span>
                        )}
                        <Link
                          className="le-tname"
                          href={`/teams/${r.team_id}`}
                        >
                          {meta?.name ?? r.team_id}
                        </Link>
                      </span>
                    </td>
                    <td>{r.w}</td>
                    <td>{r.l}</td>
                    {anyTies && <td>{r.t}</td>}
                    {pointsScheme && (
                      <td>
                        <b>{computePoints(r, pointsScheme)}</b>
                      </td>
                    )}
                    <td>{formatPct(r.pct)}</td>
                    <td>{r.gb === 0 ? "-" : r.gb.toFixed(1)}</td>
                    {showRunsCols && (
                      <>
                        <td>{r.rs}</td>
                        <td>{r.ra}</td>
                        <td>
                          {r.rd > 0 ? `+${r.rd}` : r.rd === 0 ? "0" : r.rd}
                        </td>
                      </>
                    )}
                    {showStreak && (
                      <td className={streakClass(r.streak)}>
                        {r.streak ?? "-"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function streakClass(streak: string | undefined): string {
  if (!streak) return "";
  if (streak.startsWith("W")) return "win";
  if (streak.startsWith("L")) return "loss";
  if (streak.startsWith("T")) return "tie";
  return "";
}

function formatPct(p: number): string {
  if (p === 1) return "1.000";
  return p.toFixed(3).replace(/^0/, "");
}

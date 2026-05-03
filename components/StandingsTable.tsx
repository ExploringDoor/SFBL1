// DVSL-style standings. Two variants:
//   • full: standalone /standings page with all columns + rubric
//   • compact: home page sidebar with Team | W | L | PCT | GB | STRK
//
// Uses the .s-tbl CSS class system from globals.css for matching DVSL
// typography/spacing exactly. Multiple division groups stack vertically.

import Link from "next/link";
import {
  computePoints,
  type PointsScheme,
  type StandingsRow,
} from "@/lib/stats/shared";
import { TeamBadge } from "./TeamBadge";

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

export function StandingsTable({
  groups,
  teamMeta,
  pointsScheme,
  variant = "full",
}: {
  groups: DivisionGroup[];
  teamMeta: Record<string, TeamMeta>;
  pointsScheme: PointsScheme | null;
  variant?: "full" | "compact";
}) {
  return (
    <div className="space-y-6">
      {groups.map(({ division, rows }) => (
        <section key={division ?? "league"}>
          {division && (
            <h3
              className="font-barlow mb-2"
              style={{
                fontSize: variant === "compact" ? 12 : 14,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.18em",
                color: "var(--muted)",
              }}
            >
              {division}
            </h3>
          )}
          <div
            className="overflow-x-auto"
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              overflow: "hidden",
              background: "var(--card)",
            }}
          >
            <table className={"s-tbl " + (variant === "compact" ? "s-tbl-compact" : "")}>
              <thead>
                <tr>
                  {variant === "full" && <th className="text-left">#</th>}
                  <th className="text-left">Team</th>
                  <th>W</th>
                  <th>L</th>
                  {variant === "full" && <th>T</th>}
                  {pointsScheme && <th>PTS</th>}
                  <th>PCT</th>
                  <th>GB</th>
                  {variant === "full" && (
                    <>
                      <th>RS</th>
                      <th>RA</th>
                      <th>DIFF</th>
                    </>
                  )}
                  <th>STRK</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const meta = teamMeta[r.team_id];
                  const isLeader = i === 0;
                  return (
                    <tr key={r.team_id} className={isLeader ? "leader" : ""}>
                      {variant === "full" && (
                        <td className="text-left">
                          <span className="rank">{i + 1}</span>
                        </td>
                      )}
                      <td className="text-left">
                        <Link
                          href={`/teams/${r.team_id}`}
                          className="inline-flex items-center gap-2"
                        >
                          <TeamBadge
                            teamId={r.team_id}
                            name={meta?.name ?? r.team_id}
                            initials={meta?.abbrev}
                            color={meta?.color}
                            logoUrl={meta?.logoUrl}
                            size={variant === "compact" ? "sm" : "md"}
                          />
                          <span className="tname">
                            {variant === "compact"
                              ? meta?.abbrev ?? meta?.name ?? r.team_id
                              : meta?.name ?? r.team_id}
                          </span>
                        </Link>
                      </td>
                      <td>{r.w}</td>
                      <td>{r.l}</td>
                      {variant === "full" && <td>{r.t}</td>}
                      {pointsScheme && (
                        <td>
                          <b>{computePoints(r, pointsScheme)}</b>
                        </td>
                      )}
                      <td>{formatPct(r.pct)}</td>
                      <td>{r.gb === 0 ? "—" : r.gb.toFixed(1)}</td>
                      {variant === "full" && (
                        <>
                          <td>{r.rs}</td>
                          <td>{r.ra}</td>
                          <td className={r.rd > 0 ? "diff-pos" : r.rd < 0 ? "diff-neg" : ""}>
                            {r.rd > 0 ? `+${r.rd}` : r.rd}
                          </td>
                        </>
                      )}
                      <td className={streakClass(r.streak)}>{r.streak ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function streakClass(streak: string | undefined): string {
  if (!streak) return "";
  if (streak.startsWith("W")) return "strk-w";
  if (streak.startsWith("L")) return "strk-l";
  return "";
}

function formatPct(p: number): string {
  if (p === 1) return "1.000";
  return p.toFixed(3).replace(/^0/, "");
}

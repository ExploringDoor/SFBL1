// /print/standings — division-grouped standings, print-friendly.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  computeStandings,
  type GameResult,
  type StandingsRow,
} from "@/lib/stats/shared";
import "../print.css";
import { PrintToolbar } from "../PrintToolbar";

export const dynamic = "force-dynamic";

export default async function PrintStandingsPage() {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) {
    return (
      <div className="print-page">
        <p>No tenant. Visit on a tenant subdomain.</p>
      </div>
    );
  }

  const db = getAdminDb();
  const [gameSnap, teamSnap, leagueSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
    db.doc(`leagues/${tenantId}`).get(),
  ]);

  const teamName = new Map<string, string>();
  const teamDivision = new Map<string, string>();
  for (const d of teamSnap.docs) {
    teamName.set(d.id, String(d.data().name ?? d.id));
    teamDivision.set(d.id, String(d.data().division ?? ""));
  }

  // Build GameResult list. We tag each with its division (from
  // game doc, falling back to home team's division) so we can
  // bucket per-division below.
  type GameWithDiv = GameResult & { division: string };
  const games: GameWithDiv[] = [];
  for (const d of gameSnap.docs) {
    const data = d.data();
    const status = String(data.status ?? "");
    if (status !== "final" && status !== "approved") continue;
    const aId = String(data.away_team_id ?? "");
    const hId = String(data.home_team_id ?? "");
    const aScore = Number(data.away_score);
    const hScore = Number(data.home_score);
    if (!aId || !hId || !Number.isFinite(aScore) || !Number.isFinite(hScore)) {
      continue;
    }
    games.push({
      away_team_id: aId,
      home_team_id: hId,
      away_score: aScore,
      home_score: hScore,
      status: status as GameResult["status"],
      date: String(data.date ?? ""),
      division: String(data.division ?? teamDivision.get(hId) ?? ""),
    });
  }

  // Group games by division, compute standings per division.
  const divisions = new Map<string, GameResult[]>();
  for (const g of games) {
    const div = g.division || "—";
    if (!divisions.has(div)) divisions.set(div, []);
    divisions.get(div)!.push(g);
  }

  // Also include teams in their division even if they have no games yet.
  const teamsByDivision = new Map<string, string[]>();
  for (const [tid, div] of teamDivision.entries()) {
    const k = div || "—";
    if (!teamsByDivision.has(k)) teamsByDivision.set(k, []);
    teamsByDivision.get(k)!.push(tid);
  }

  const sortedDivisions = Array.from(
    new Set([...divisions.keys(), ...teamsByDivision.keys()]),
  ).sort((a, b) => {
    const an = parseInt(a, 10);
    const bn = parseInt(b, 10);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
    return a.localeCompare(b);
  });

  const leagueName = String(leagueSnap.data()?.name ?? tenantId);

  return (
    <div className="print-page">
      <PrintToolbar />
      <header className="print-header">
        <div>
          <div className="print-title">{leagueName} Standings</div>
          <div className="print-meta">{games.length} final games</div>
        </div>
        <div className="print-meta">
          Printed {new Date().toLocaleDateString()}
        </div>
      </header>

      {sortedDivisions.map((div) => {
        const divGames = divisions.get(div) ?? [];
        const divTeamIds = teamsByDivision.get(div) ?? [];
        // Compute, then merge in zero-row for teams with no games yet.
        const computed = computeStandings(divGames);
        const seen = new Set(computed.map((r) => r.team_id));
        const zeroes: StandingsRow[] = divTeamIds
          .filter((id) => !seen.has(id))
          .map((id) => ({
            team_id: id, gp: 0, w: 0, l: 0, t: 0,
            rs: 0, ra: 0, rd: 0, pct: 0, gb: 0,
          }));
        const rows = [...computed, ...zeroes].sort((a, b) => {
          if (a.pct !== b.pct) return b.pct - a.pct;
          return b.rd - a.rd;
        });
        return (
          <section key={div} className="print-section">
            <h2 className="print-section-heading">
              {div === "—" ? "Other" : div} Division
            </h2>
            <table className="print-table">
              <thead>
                <tr>
                  <th style={{ width: 30 }}>#</th>
                  <th>Team</th>
                  <th className="print-num" style={{ width: 50 }}>W</th>
                  <th className="print-num" style={{ width: 50 }}>L</th>
                  <th className="print-num" style={{ width: 50 }}>T</th>
                  <th className="print-num" style={{ width: 60 }}>PCT</th>
                  <th className="print-num" style={{ width: 50 }}>RS</th>
                  <th className="print-num" style={{ width: 50 }}>RA</th>
                  <th className="print-num" style={{ width: 50 }}>DIFF</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.team_id}>
                    <td className="print-num">{i + 1}</td>
                    <td><strong>{teamName.get(r.team_id) ?? r.team_id}</strong></td>
                    <td className="print-num">{r.w}</td>
                    <td className="print-num">{r.l}</td>
                    <td className="print-num">{r.t}</td>
                    <td className="print-num">
                      {r.gp > 0 ? r.pct.toFixed(3).replace(/^0/, "") : "—"}
                    </td>
                    <td className="print-num">{r.rs}</td>
                    <td className="print-num">{r.ra}</td>
                    <td className="print-num">
                      {r.rd >= 0 ? "+" : ""}
                      {r.rd}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

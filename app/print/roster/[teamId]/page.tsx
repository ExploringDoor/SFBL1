// /print/roster/[teamId] — single team's roster, print-friendly.
//
// Public — same data as the team page. Includes name, jersey,
// position. Excludes email/phone (those need /print/contacts which
// is admin-gated).

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import "../../print.css";
import { PrintToolbar } from "../../PrintToolbar";

export const dynamic = "force-dynamic";

export default async function PrintRosterPage({
  params,
}: {
  params: { teamId: string };
}) {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) {
    return (
      <div className="print-page">
        <p>No tenant. Visit on a tenant subdomain.</p>
      </div>
    );
  }

  const db = getAdminDb();
  const [teamSnap, leagueSnap, playerSnap] = await Promise.all([
    db.doc(`leagues/${tenantId}/teams/${params.teamId}`).get(),
    db.doc(`leagues/${tenantId}`).get(),
    db
      .collection(`leagues/${tenantId}/players`)
      .where("team_id", "==", params.teamId)
      .get(),
  ]);

  if (!teamSnap.exists) {
    return (
      <div className="print-page">
        <PrintToolbar />
        <p>Team not found: {params.teamId}</p>
      </div>
    );
  }

  const teamData = teamSnap.data() ?? {};
  const teamName = String(teamData.name ?? params.teamId);
  const division = String(teamData.division ?? "");
  const leagueName = String(leagueSnap.data()?.name ?? tenantId);

  const players = playerSnap.docs
    .filter((d) => d.data().active !== false)
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: String(data.name ?? ""),
        jersey: String(data.jersey ?? ""),
        position: String(data.position ?? ""),
        walk_on: data.walk_on === true,
      };
    })
    .sort((a, b) => {
      const aj = parseInt(a.jersey || "999", 10);
      const bj = parseInt(b.jersey || "999", 10);
      if (!Number.isNaN(aj) && !Number.isNaN(bj) && aj !== bj) return aj - bj;
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="print-page">
      <PrintToolbar />
      <header className="print-header">
        <div>
          <div className="print-title">{teamName}</div>
          <div className="print-meta">
            {leagueName}
            {division ? ` · ${division}` : ""}
          </div>
        </div>
        <div className="print-meta">
          {players.length} player{players.length === 1 ? "" : "s"} · printed{" "}
          {new Date().toLocaleDateString()}
        </div>
      </header>

      {players.length === 0 ? (
        <p>No players on this roster.</p>
      ) : (
        <table className="print-table">
          <thead>
            <tr>
              <th style={{ width: 50 }}>#</th>
              <th>Name</th>
              <th style={{ width: 120 }}>Position</th>
              <th style={{ width: 100 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id}>
                <td className="print-num">{p.jersey || "—"}</td>
                <td><strong>{p.name}</strong></td>
                <td>{p.position || "—"}</td>
                <td>
                  {p.walk_on ? (
                    <span className="print-status-pill print-status-postponed">
                      Pending
                    </span>
                  ) : (
                    <span className="print-status-pill print-status-final">
                      Active
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

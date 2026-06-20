// Intercepted modal for /players/[id]. Renders player detail (name,
// team, batting + pitching season stats) inside a modal when navigated
// to from within the app. Direct URL access falls through to the full
// page.

import Link from "next/link";
import { headers } from "next/headers";
import { Modal } from "@/components/Modal";
import { getAdminDb } from "@/lib/firebase-admin";
import { TeamBadge } from "@/components/TeamBadge";
import { formatIP } from "@/lib/stats/ip";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { statsEnabled } from "@/lib/tenant-flags";

export const dynamic = "force-dynamic";

export default async function PlayerModalRoute({
  params,
}: {
  params: { playerId: string };
}) {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  if (!tenantId) return null;

  // Stats-off tenants (COYBL) have no player detail — render nothing.
  const config = (() => {
    const raw = h.get("x-tenant-config-json");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicLeagueConfig;
    } catch {
      return null;
    }
  })();
  if (!statsEnabled(config)) return null;

  const db = getAdminDb();
  const playerSnap = await db
    .doc(`leagues/${tenantId}/players/${params.playerId}`)
    .get();
  if (!playerSnap.exists) return null;
  const data = playerSnap.data() ?? {};
  const name = String(data.name ?? params.playerId);
  const teamId = String(data.team_id ?? "");
  const stats = (data.stats ?? null) as Record<string, number> | null;
  const pitching = (data.pitching ?? null) as Record<string, number> | null;

  let teamName: string | null = null;
  let teamLogo: string | null = null;
  let teamColor: string | undefined;
  let teamAbbrev: string | undefined;
  if (teamId) {
    const teamSnap = await db.doc(`leagues/${tenantId}/teams/${teamId}`).get();
    if (teamSnap.exists) {
      const t = teamSnap.data() ?? {};
      teamName = String(t.name ?? teamId);
      teamLogo = t.logo_url ? String(t.logo_url) : null;
      teamColor = t.color ? String(t.color) : undefined;
      teamAbbrev = t.abbrev ? String(t.abbrev) : undefined;
    }
  }

  return (
    <Modal title={name}>
      <div className="modal-hero">
        <div className="modal-av">
          {teamId && (
            <TeamBadge
              teamId={teamId}
              name={teamName ?? teamId}
              initials={teamAbbrev}
              color={teamColor}
              logoUrl={teamLogo}
              size="lg"
            />
          )}
        </div>
        <div>
          <h2 className="modal-pname">{name}</h2>
          <p style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>
            {data.jersey != null && <span>#{String(data.jersey)} · </span>}
            {data.position && <span>{String(data.position)} · </span>}
            {teamId && (
              <Link
                href={`/teams/${teamId}`}
                style={{ color: "var(--text-strong)" }}
              >
                {teamName ?? teamId}
              </Link>
            )}
          </p>
          {stats && Number(stats.gp ?? 0) > 0 && (
            <div className="modal-stat-pill">
              <div className="msp-item">
                <div className="msp-val">{stats.ab}</div>
                <div className="msp-lbl">AB</div>
              </div>
              <div className="msp-sep" />
              <div className="msp-item">
                <div className="msp-val">{formatAvg(Number(stats.avg ?? 0))}</div>
                <div className="msp-lbl">AVG</div>
              </div>
              <div className="msp-sep" />
              <div className="msp-item">
                <div className="msp-val">{stats.hr}</div>
                <div className="msp-lbl">HR</div>
              </div>
              <div className="msp-sep" />
              <div className="msp-item">
                <div className="msp-val">{stats.rbi}</div>
                <div className="msp-lbl">RBI</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {stats && Number(stats.gp ?? 0) > 0 && (
        <>
          <div className="modal-batting-hdr">
            <div className="modal-batting-title">Batting</div>
          </div>
          <div className="bat-tbl-wrap">
            <table className="bat-tbl">
              <thead>
                <tr>
                  <th>GP</th>
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
                  <td>{stats.gp}</td>
                  <td>{stats.ab}</td>
                  <td>{stats.r}</td>
                  <td>{stats.h}</td>
                  <td>{stats.doubles}</td>
                  <td>{stats.triples}</td>
                  <td>{stats.hr}</td>
                  <td>{stats.rbi}</td>
                  <td>{stats.bb}</td>
                  <td>{stats.so}</td>
                  <td>{formatAvg(Number(stats.avg ?? 0))}</td>
                  <td>{formatAvg(Number(stats.obp ?? 0))}</td>
                  <td>{formatAvg(Number(stats.slg ?? 0))}</td>
                  <td>{formatAvg(Number(stats.ops ?? 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {pitching && Number(pitching.app ?? 0) > 0 && (
        <>
          <div className="modal-batting-hdr">
            <div className="modal-batting-title">Pitching</div>
          </div>
          <div className="bat-tbl-wrap">
            <table className="bat-tbl">
              <thead>
                <tr>
                  <th>APP</th>
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
                  <td>{pitching.app}</td>
                  <td>{pitching.w}</td>
                  <td>{pitching.l}</td>
                  <td>{pitching.sv}</td>
                  <td>{formatIP(Number(pitching.ip_outs ?? 0))}</td>
                  <td>{pitching.h}</td>
                  <td>{pitching.r}</td>
                  <td>{pitching.er}</td>
                  <td>{pitching.bb}</td>
                  <td>{pitching.so}</td>
                  <td>{pitching.hr}</td>
                  <td>{Number(pitching.era ?? 0).toFixed(2)}</td>
                  <td>{Number(pitching.whip ?? 0).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

function formatAvg(n: number): string {
  if (n === 1) return "1.000";
  return n.toFixed(3).replace(/^0/, "");
}

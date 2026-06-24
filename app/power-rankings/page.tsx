// Power Rankings — RPI per age group, computed on-platform from game results
// (lib/rpi). Demonstrates the "own your rankings" path: no external service,
// no GameChanger scrape — just the games on the site. Gated by
// flags.show_power_rankings. Per age group with jump tabs, like /standings.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { computeRpi, type RpiGame, type RpiRow } from "@/lib/rpi";

export const dynamic = "force-dynamic";

interface TeamMeta {
  name: string;
  abbrev?: string;
  color?: string;
  ageGroup?: string;
}

type RankedRow = RpiRow & { name: string };

interface AgeRanking {
  ageGroup: string;
  rows: RankedRow[];
}

export default async function PowerRankingsPage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id");

  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

  const { sections } = await loadRankings(tenantId);

  return (
    <main className="container py-10">
      <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6, maxWidth: 640, marginBottom: 20 }}>
        Ranked by <strong>RPI</strong> (Ratings Percentage Index), which weighs
        strength of schedule: 25% your win %, 50% your opponents&rsquo; win %,
        25% your opponents&rsquo; opponents&rsquo; win %. A strong-schedule team
        can outrank a team with a flashier record.
      </p>

      {sections.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No ranked games yet.</p>
      ) : (
        <>
          {sections.length > 1 && (
            <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
              {sections.map((s) => (
                <a
                  key={s.ageGroup}
                  href={`#age-${s.ageGroup}`}
                  style={{
                    display: "inline-block",
                    padding: "6px 14px",
                    borderRadius: 999,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    color: "var(--brand-primary)",
                    fontWeight: 800,
                    fontSize: 13,
                    textDecoration: "none",
                  }}
                >
                  {s.ageGroup}
                </a>
              ))}
            </nav>
          )}

          {sections.map((s) => (
            <section
              key={s.ageGroup}
              id={`age-${s.ageGroup}`}
              style={{ marginBottom: 32, scrollMarginTop: 16 }}
            >
              <h2
                className="font-display"
                style={{
                  fontSize: 28,
                  marginBottom: 12,
                  color: "var(--brand-primary)",
                  borderBottom: "3px solid var(--brand-primary)",
                  paddingBottom: 6,
                }}
              >
                {s.ageGroup}
              </h2>
              <div className="overflow-x-auto">
                <table className="s-tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th className="text-left">Team</th>
                      <th>W-L-T</th>
                      <th>SOS</th>
                      <th>RPI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.rows.map((r, i) => (
                      <tr key={r.team_id}>
                        <td>{i + 1}</td>
                        <td className="text-left" style={{ fontWeight: 700 }}>
                          {r.name}
                        </td>
                        <td>
                          {r.w}-{r.l}
                          {r.t ? `-${r.t}` : ""}
                        </td>
                        <td style={{ color: "var(--muted)" }}>{r.owp.toFixed(3)}</td>
                        <td style={{ fontWeight: 800, color: "var(--brand-primary)" }}>
                          {r.rpi.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
    </main>
  );
}

async function loadRankings(tenantId: string): Promise<{ sections: AgeRanking[] }> {
  const db = getAdminDb();
  const [gamesSnap, teamsSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
  ]);

  const teams: Record<string, TeamMeta> = {};
  for (const d of teamsSnap.docs) {
    const data = d.data();
    teams[d.id] = {
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      color: data.color ? String(data.color) : undefined,
      ageGroup: data.ageGroup ? String(data.ageGroup) : undefined,
    };
  }

  const games: RpiGame[] = gamesSnap.docs.map((d) => {
    const data = d.data();
    return {
      home_team_id: String(data.home_team_id ?? ""),
      away_team_id: String(data.away_team_id ?? ""),
      home_score: Number(data.home_score ?? 0),
      away_score: Number(data.away_score ?? 0),
      status: String(data.status ?? "draft"),
    };
  });

  const ages = new Set<string>();
  for (const t of Object.values(teams)) if (t.ageGroup) ages.add(t.ageGroup);

  const sections: AgeRanking[] = [...ages]
    .sort((a, b) => ageOrder(a) - ageOrder(b))
    .map((ageGroup) => {
      const idSet = new Set(
        Object.entries(teams)
          .filter(([, t]) => t.ageGroup === ageGroup)
          .map(([id]) => id),
      );
      const groupGames = games.filter(
        (g) => idSet.has(g.home_team_id) && idSet.has(g.away_team_id),
      );
      const rows = computeRpi(groupGames)
        .filter((r) => idSet.has(r.team_id))
        .map((r) => ({ ...r, name: teams[r.team_id]?.name ?? r.team_id }));
      return { ageGroup, rows };
    })
    .filter((s) => s.rows.length > 0);

  return { sections };
}

function ageOrder(ageGroup: string): number {
  const m = ageGroup.match(/\d+/);
  return m ? parseInt(m[0], 10) : 999;
}

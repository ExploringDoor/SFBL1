// Teams index: grid of clickable team cards. Age-grouped leagues (COYBL)
// group Age Group -> Division with jump tabs; flat leagues (SFBL) group by
// division only. Ordering helpers shared with lib/standings.

import Link from "next/link";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { TeamBadge } from "@/components/TeamBadge";
import {
  computeStandings,
  computePoints,
  sortByPoints,
  type GameResult,
  type StandingsRow,
} from "@/lib/stats/shared";
import { ageOrder, divOrder } from "@/lib/standings";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

interface TeamCard {
  id: string;
  name: string;
  abbrev?: string;
  division: string | null;
  ageGroup?: string;
  color?: string;
  logoUrl?: string | null;
  record: string;
  points: number | null;
}

interface DivisionGroup {
  division: string;
  teams: TeamCard[];
}
interface AgeSection {
  ageGroup: string | null;
  divisions: DivisionGroup[];
}

export default async function TeamsPage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  const config = (() => {
    const raw = h.get("x-tenant-config-json");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicLeagueConfig;
    } catch {
      return null;
    }
  })();

  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

  const db = getAdminDb();
  const [teamsSnap, gamesSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/teams`).get(),
    db.collection(`leagues/${tenantId}/games`).get(),
  ]);

  const games: GameResult[] = gamesSnap.docs.map((d) => {
    const data = d.data();
    return {
      home_team_id: String(data.home_team_id ?? ""),
      away_team_id: String(data.away_team_id ?? ""),
      home_score: Number(data.home_score ?? 0),
      away_score: Number(data.away_score ?? 0),
      status: (data.status ?? "draft") as GameResult["status"],
      date: data.date ? String(data.date) : undefined,
    };
  });
  let standings: StandingsRow[] = computeStandings(games);
  const scheme = config?.standings?.points_per ?? null;
  const usePoints = config?.standings?.scoring === "points" && !!scheme;
  if (usePoints && scheme) {
    standings = sortByPoints(standings, scheme, config?.standings?.tiebreaker ?? "rd");
  }
  const recordByTeam = new Map(standings.map((r) => [r.team_id, r]));
  const orderIndex = new Map(standings.map((r, i) => [r.team_id, i]));

  const teams: TeamCard[] = teamsSnap.docs.map((d) => {
    const data = d.data();
    const row = recordByTeam.get(d.id);
    return {
      id: d.id,
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      division: data.division ? String(data.division) : null,
      ageGroup: data.ageGroup ? String(data.ageGroup) : undefined,
      color: data.color ? String(data.color) : undefined,
      logoUrl: data.logo_url ? String(data.logo_url) : null,
      record: row ? formatRecord(row.w, row.l, row.t) : "0-0",
      points: row && usePoints && scheme ? computePoints(row, scheme) : null,
    };
  });

  const sortTeams = (list: TeamCard[]) =>
    list.sort((a, b) => {
      const ai = orderIndex.get(a.id) ?? Infinity;
      const bi = orderIndex.get(b.id) ?? Infinity;
      return ai - bi || a.name.localeCompare(b.name);
    });

  const hasAge = teams.some((t) => t.ageGroup);
  let sections: AgeSection[];

  if (hasAge) {
    const byAge = new Map<string, Map<string, TeamCard[]>>();
    for (const t of teams) {
      const ag = t.ageGroup ?? "Other";
      const div = t.division ?? "Division";
      if (!byAge.has(ag)) byAge.set(ag, new Map());
      const dm = byAge.get(ag)!;
      if (!dm.has(div)) dm.set(div, []);
      dm.get(div)!.push(t);
    }
    sections = [...byAge.entries()]
      .sort(([a], [b]) => ageOrder(a) - ageOrder(b))
      .map(([ageGroup, dm]) => ({
        ageGroup,
        divisions: [...dm.entries()]
          .sort(([a], [b]) => divOrder(a) - divOrder(b))
          .map(([division, list]) => ({ division, teams: sortTeams(list) })),
      }));
  } else {
    const byDiv = new Map<string, TeamCard[]>();
    for (const t of teams) {
      const key = t.division ?? "League";
      if (!byDiv.has(key)) byDiv.set(key, []);
      byDiv.get(key)!.push(t);
    }
    sections = [
      {
        ageGroup: null,
        divisions: [...byDiv.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([division, list]) => ({ division, teams: sortTeams(list) })),
      },
    ];
  }

  const grouped = sections.length > 0 && sections[0]?.ageGroup != null;

  return (
    <main className="container py-10">
      {grouped && sections.length > 1 && (
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

      <div className="space-y-10">
        {sections.map((section) => (
          <section
            key={section.ageGroup ?? "all"}
            id={section.ageGroup ? `age-${section.ageGroup}` : undefined}
            style={{ scrollMarginTop: 16 }}
          >
            {section.ageGroup && (
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
                {section.ageGroup}
              </h2>
            )}
            <div className="space-y-8">
              {section.divisions.map((dg) => (
                <div key={dg.division}>
                  <h3
                    className="font-barlow mb-4"
                    style={{
                      fontSize: 14,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.18em",
                      color: "var(--muted)",
                    }}
                  >
                    {dg.division}
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {dg.teams.map((t) => (
                      <Link
                        key={t.id}
                        href={`/teams/${t.id}`}
                        className="block"
                        style={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 14,
                          padding: 16,
                          textAlign: "center",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                          <TeamBadge
                            teamId={t.id}
                            name={t.name}
                            initials={t.abbrev}
                            color={t.color}
                            logoUrl={t.logoUrl}
                            size="lg"
                          />
                        </div>
                        <div
                          className="font-oswald"
                          style={{
                            fontSize: 18,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            lineHeight: 1.1,
                            color: "var(--text-strong)",
                          }}
                        >
                          {t.name}
                        </div>
                        <div
                          className="font-barlow"
                          style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}
                        >
                          {t.record}
                          {t.points != null && (
                            <span style={{ marginLeft: 8, color: "var(--brand-primary)", fontWeight: 800 }}>
                              {t.points} PTS
                            </span>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

function formatRecord(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

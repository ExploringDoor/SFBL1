// DVSL-style teams index: grid of team cards organized by division,
// each card clickable to /teams/[id] (the team's detail page).

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
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

interface TeamCard {
  id: string;
  name: string;
  abbrev?: string;
  division: string | null;
  color?: string;
  logoUrl?: string | null;
  record: string;
  points: number | null;
  rd: number;
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

  const teams: TeamCard[] = teamsSnap.docs.map((d) => {
    const data = d.data();
    const row = recordByTeam.get(d.id);
    return {
      id: d.id,
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      division: data.division ? String(data.division) : null,
      color: data.color ? String(data.color) : undefined,
      logoUrl: data.logo_url ? String(data.logo_url) : null,
      record: row ? formatRecord(row.w, row.l, row.t) : "0-0",
      points: row && usePoints && scheme ? computePoints(row, scheme) : null,
      rd: row?.rd ?? 0,
    };
  });

  // Group by division.
  const byDivision = new Map<string, TeamCard[]>();
  for (const t of teams) {
    const key = t.division ?? "League";
    if (!byDivision.has(key)) byDivision.set(key, []);
    byDivision.get(key)!.push(t);
  }
  for (const [, list] of byDivision) {
    list.sort((a, b) => {
      const ai = standings.findIndex((r) => r.team_id === a.id);
      const bi = standings.findIndex((r) => r.team_id === b.id);
      if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }
  const divisions = [...byDivision.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <main className="container py-10">
      <header className="mb-8">
        <h1 className="font-display" style={{ fontSize: "clamp(40px, 6vw, 64px)" }}>
          <span style={{ color: "var(--text-strong)" }}>League</span>{" "}
          <span style={{ color: "var(--brand-primary)" }}>Teams</span>
        </h1>
        {config?.name && <p className="sec-eyebrow mt-1">{config.name}</p>}
      </header>

      <div className="space-y-10">
        {divisions.map(([division, list]) => (
          <section key={division}>
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
              {division}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {list.map((t) => (
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
                  <div className="font-barlow" style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
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
          </section>
        ))}
      </div>
    </main>
  );
}

function formatRecord(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

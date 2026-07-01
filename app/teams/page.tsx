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
  ageGroup?: string;
  ageOrder: number;
  divOrder: number;
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
      ageGroup: data.ageGroup ? String(data.ageGroup) : undefined,
      ageOrder: typeof data.ageOrder === "number" ? data.ageOrder : 999,
      divOrder: typeof data.divOrder === "number" ? data.divOrder : 999,
      color: data.color ? String(data.color) : undefined,
      logoUrl: data.logo_url ? String(data.logo_url) : null,
      // Stats-off leagues store the exact league record on the team doc
      // (see standings page) — prefer it so cards match the standings.
      record: data.record
        ? String(data.record)
        : row
          ? formatRecord(row.w, row.l, row.t)
          : "0-0",
      points: row && usePoints && scheme ? computePoints(row, scheme) : null,
      rd: row?.rd ?? 0,
    };
  });

  // Order teams within a division: by standings position, else name.
  const teamOrder = (a: TeamCard, b: TeamCard) => {
    const ai = standings.findIndex((r) => r.team_id === a.id);
    const bi = standings.findIndex((r) => r.team_id === b.id);
    if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  };

  type DivGroup = { division: string; teams: TeamCard[] };
  const divisionsOf = (list: TeamCard[]): DivGroup[] => {
    const byDiv = new Map<string, TeamCard[]>();
    for (const t of list) {
      const key = t.division ?? "Division";
      if (!byDiv.has(key)) byDiv.set(key, []);
      byDiv.get(key)!.push(t);
    }
    return [...byDiv.entries()]
      .sort(
        ([, a], [, b]) =>
          (a[0]?.divOrder ?? 999) - (b[0]?.divOrder ?? 999) ||
          (a[0]?.division ?? "").localeCompare(b[0]?.division ?? ""),
      )
      .map(([division, ts]) => ({ division, teams: [...ts].sort(teamOrder) }));
  };

  // Age-grouped tenants (COYBL) get Age Group -> Division; flat tenants get one
  // section with their divisions (so SFBL/LBDC render exactly as before).
  const hasAge = teams.some((t) => t.ageGroup);
  type AgeSection = { ageGroup: string | null; divisions: DivGroup[] };
  let sections: AgeSection[];
  if (hasAge) {
    const byAge = new Map<string, TeamCard[]>();
    for (const t of teams) {
      const ag = t.ageGroup ?? "Other";
      if (!byAge.has(ag)) byAge.set(ag, []);
      byAge.get(ag)!.push(t);
    }
    sections = [...byAge.entries()]
      .sort(
        ([, a], [, b]) =>
          (a[0]?.ageOrder ?? 999) - (b[0]?.ageOrder ?? 999) ||
          (a[0]?.ageGroup ?? "").localeCompare(b[0]?.ageGroup ?? ""),
      )
      .map(([ageGroup, list]) => ({ ageGroup, divisions: divisionsOf(list) }));
  } else {
    sections = [{ ageGroup: null, divisions: divisionsOf(teams) }];
  }

  return (
    <main className="container py-10">
      {!config?.flags?.hide_page_titles && (
        <header className="mb-8">
          <h1 className="font-display" style={{ fontSize: "clamp(40px, 6vw, 64px)" }}>
            <span style={{ color: "var(--text-strong)" }}>League</span>{" "}
            <span style={{ color: "var(--brand-primary)" }}>Teams</span>
          </h1>
          {config?.name && <p className="sec-eyebrow mt-1">{config.name}</p>}
        </header>
      )}

      {/* Age jump-nav — shown even when the page title is hidden (it's
          functional, not decorative): with 196 teams the one-per-row
          mobile grid is a long scroll, so let users jump to their age. */}
      {hasAge && sections.length > 1 && (
        <nav
          aria-label="Jump to age group"
          style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}
        >
          {sections.map((s) => (
            <a
              key={s.ageGroup}
              href={`#age-${s.ageGroup}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: 44,
                padding: "8px 16px",
                borderRadius: 999,
                border: "1px solid rgba(0,0,0,0.12)",
                background: "#fff",
                color: "var(--brand-primary)",
                fontWeight: 800,
                fontSize: 14,
                letterSpacing: "0.04em",
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
                className="font-barlow"
                style={{
                  fontSize: 28,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  color: "var(--brand-primary)",
                  borderBottom: "3px solid var(--brand-primary)",
                  paddingBottom: 6,
                  marginBottom: 16,
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
                        className="block group"
                        style={{ textAlign: "center", padding: "8px 4px" }}
                      >
                        <div
                          style={{
                            width: 112,
                            height: 112,
                            margin: "0 auto 14px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <TeamBadge
                            teamId={t.id}
                            name={t.name}
                            initials={t.abbrev}
                            color={t.color}
                            logoUrl={t.logoUrl}
                            size="card"
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

// DVSL-style teams index: grid of team cards organized by division,
// each card clickable to /teams/[id] (the team's detail page).

import Link from "next/link";
import { headers } from "next/headers";
import { DemoDataBanner } from "@/components/ui/DemoDataBanner";
import { TeamsHiddenNotice } from "@/components/ui/TeamsHiddenNotice";
import {
  getCachedGamesSnap,
  getCachedTeamsSnap,
} from "@/lib/league-cache";
import { TeamBadge } from "@/components/TeamBadge";
import { TeamsBrowser, type BrowserTeam } from "@/components/ui/TeamsBrowser";
import { teamLogoSrc } from "@/lib/team-logo";
import {
  computeStandings,
  computePoints,
  sortByPoints,
  type GameResult,
  type StandingsRow,
  computeStandingsWithExtraGameRule,
} from "@/lib/stats/shared";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

// Per-page title -> "Teams · <abbrev>" via the layout template (was just
// the bare league name on every page).
export const metadata = { title: "Teams" };


// Windmill files teams under a division that IS the age group (no separate
// ageGroup field), and the raw values sort alphabetically wrong (U10 before U8,
// uHigh last). Map each to a clean label + true age order for the browser.
const WF_DIVISIONS = new Map<string, { label: string; order: number }>([
  ["U8 Mach", { label: "8U Machine", order: 1 }],
  ["U8 Live", { label: "8U Live", order: 2 }],
  ["U10", { label: "10U", order: 3 }],
  ["U10 USA", { label: "10U USA", order: 4 }],
  ["U12", { label: "12U", order: 5 }],
  ["U14", { label: "14U", order: 6 }],
  ["uHigh", { label: "High School", order: 7 }],
]);

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

  // Who has signed up is not public yet.
  //
  // Mike asked for this on 2026-08-14: the office sees who has registered, the
  // public does not, until the schedule is released. A league announces its
  // field on its own terms.
  //
  // A NOTICE, not a 404. The URL is guessable and gets shared, and "this page
  // does not exist" reads as a broken site. Saying the list is coming is both
  // true and better marketing.
  //
  // The nav still links here, deliberately. nav.hide does not actually filter
  // the rendered nav (sponsors and history have sat in island's hide list for
  // weeks and still render), and a link to an explanation beats a menu item
  // that silently vanishes.
  //
  // Checked BEFORE the Firestore reads below: there is no point costing a
  // teams-and-games fetch to render a fixed paragraph.
  //
  // The admin is untouched. It reads Firestore behind its own auth check, so
  // nothing here narrows what the office can see.
  if (config?.flags?.hide_teams === true) {
    return (
      <TeamsHiddenNotice
        registrationOpen={config?.flags?.registration_open === true}
      />
    );
  }

  const [teamsSnap, gamesSnap] = await Promise.all([
    getCachedTeamsSnap(tenantId),
    getCachedGamesSnap(tenantId),
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
  // Divisions for the extra-game rule. It forgives a loss only for a team the
  // SCHEDULE gave more fixtures than the rest of its division, so the baseline
  // has to be the division, and every page that shows a record has to agree or
  // the standings page and the team page will print different numbers.
  const divisionById = new Map(
    teamsSnap.docs.map((d) => [d.id, String(d.data().division ?? "")]),
  );
  let standings: StandingsRow[] = computeStandingsWithExtraGameRule(games, {
    enabled: config?.standings?.drop_extra_game_loss,
    divisionOf: (id) => divisionById.get(id) ?? "",
  });
  const scheme = config?.standings?.points_per ?? null;
  const usePoints = config?.standings?.scoring === "points" && !!scheme;
  if (usePoints && scheme) {
    standings = sortByPoints(standings, scheme, config?.standings?.tiebreaker ?? "rd");
  }
  const recordByTeam = new Map(standings.map((r) => [r.team_id, r]));

  // Deactivating a team in the admin writes active:false, and the confirm
  // dialog promises the team "won't show up in roster lists" — but no public
  // surface read that field, so a deactivated team stayed on this page.
  // Adam hit it deactivating one (2026-08-12).
  //
  // Their GAMES are untouched, which is the other half of that promise: past
  // results still render on Scores and Schedule, with the name still resolving
  // from the team doc.
  const teams: TeamCard[] = teamsSnap.docs
    .filter((d) => d.data().active !== false)
    .map((d) => {
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
      // Server rendered, so this inlines into HTML rather than the RSC payload,
      // but eighteen cards of inlined base64 is the same bytes on the wire.
      // Island reads clean today only because hide_teams renders a notice
      // instead of the grid.
      logoUrl: teamLogoSrc(tenantId, d.id, data.logo_url),
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

  // Windmill: flat, division-keyed list for the interactive filter/list browser.
  // Sort by standings/name first, then stable-sort by age order so teams stay
  // ordered within each division. Other tenants keep the server grid below.
  const browserTeams: BrowserTeam[] =
    tenantId === "windmill"
      ? [...teams]
          .sort(teamOrder)
          .map((t) => {
            const key = t.division?.trim() ? t.division : "Division TBD";
            const meta = WF_DIVISIONS.get(key) ?? { label: key, order: 900 };
            return {
              id: t.id,
              name: t.name,
              abbrev: t.abbrev,
              division: key,
              divLabel: meta.label,
              divOrder: meta.order,
              color: t.color,
              logoUrl: t.logoUrl,
              record: t.record,
              points: t.points,
            };
          })
          .sort((a, b) => a.divOrder - b.divOrder)
      : [];

  type DivGroup = { division: string; teams: TeamCard[] };
  const divisionsOf = (list: TeamCard[]): DivGroup[] => {
    const byDiv = new Map<string, TeamCard[]>();
    for (const t of list) {
      // A team that just registered has no division yet — Doug assigns those
      // after registration. Label the bucket so the team is visible on the
      // Teams page immediately instead of sitting under a bare "Division".
      const key = t.division?.trim() ? t.division : "Division TBD";
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
    <DemoDataBanner
      show={config?.flags?.demo_data === true}
      note={config?.demo_note}
    />
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
        <nav aria-label="Jump to age group" className="le-agejump">
          <span className="le-agejump-label">Jump to</span>
          {sections.map((s) => (
            <a
              key={s.ageGroup}
              href={`#age-${s.ageGroup}`}
              className="le-agejump-btn"
            >
              {s.ageGroup}
            </a>
          ))}
        </nav>
      )}

      {/* Nothing to show yet. COYBL hides page titles, so without this the
          route rendered a completely blank body — which reads as broken
          rather than empty. Say why it is empty and what happens next. */}
      {teams.length === 0 && (
        <div
          style={{
            border: "1px dashed var(--rule, rgba(0,0,0,.15))",
            borderRadius: 12,
            padding: "40px 24px",
            textAlign: "center",
          }}
        >
          <h1
            className="font-display"
            style={{
              fontSize: "clamp(26px, 4vw, 38px)",
              lineHeight: 1.1,
              color: "var(--text-strong)",
              margin: "0 0 10px",
            }}
          >
            Teams appear here as coaches register
          </h1>
          <p style={{ color: "var(--muted)", maxWidth: 460, margin: "0 auto" }}>
            Every team shows up on this page as soon as its coach signs up, and
            the league adds divisions shortly after.
          </p>
          {config?.flags?.registration_open && (
            <p style={{ marginTop: 20 }}>
              <Link
                href="/team-registration"
                className="le-cap-btn-primary"
                style={{
                  display: "inline-block",
                  padding: "12px 26px",
                  background: "var(--brand-primary)",
                  color: "#fff",
                  borderRadius: 10,
                  fontWeight: 800,
                  letterSpacing: ".04em",
                  textTransform: "uppercase",
                  textDecoration: "none",
                  fontSize: 14,
                }}
              >
                Register your team
              </Link>
            </p>
          )}
        </div>
      )}

      {tenantId === "windmill" && teams.length > 0 ? (
        <TeamsBrowser teams={browserTeams} usePoints={usePoints} />
      ) : (
      <div className="space-y-10">
        {sections.map((section) => (
          <section
            key={section.ageGroup ?? "all"}
            id={section.ageGroup ? `age-${section.ageGroup}` : undefined}
            style={{
              // Sticky nav: see the matching note on the standings page.
              scrollMarginTop:
                "calc(var(--header-height, 62px) + 16px + env(safe-area-inset-top, 0px))",
            }}
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
      )}
    </main>
  );
}

function formatRecord(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

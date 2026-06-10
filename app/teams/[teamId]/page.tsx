// DVSL-style team detail page: hero strip with team logo + name +
// record, two-column layout (roster left, recent games right).

import * as fs from "node:fs";
import * as path from "node:path";
import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminDb } from "@/lib/firebase-admin";
import { TeamBadge } from "@/components/TeamBadge";
import { SubscribeCalendar } from "@/components/SubscribeCalendar";
import {
  computePoints,
  computeStandings,
  sortByPoints,
  type GameResult,
} from "@/lib/stats/shared";
import { formatIP } from "@/lib/stats/ip";
import { formatGameDate } from "@/lib/format-time";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

// Rich link previews for team pages. Shared in iMessage / WhatsApp /
// X / Slack — captains pasting "check our roster" links should see
// the team's name + logo, not the generic league preview.
export async function generateMetadata({
  params,
}: {
  params: { teamId: string };
}): Promise<Metadata> {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) return {};
  const snap = await getAdminDb()
    .doc(`leagues/${tenantId}/teams/${params.teamId}`)
    .get();
  if (!snap.exists) return {};
  const data = snap.data() ?? {};
  const teamName = String(data.name ?? params.teamId);
  const division = String(data.division ?? "");
  const logo = String(data.logo_url ?? "");
  const description = `${teamName}${division ? ` — ${division} division` : ""}. Roster, schedule, recent games, and team stats.`;
  return {
    title: teamName,
    description,
    openGraph: {
      title: teamName,
      description,
      type: "website",
      ...(logo ? { images: [{ url: logo, alt: teamName }] } : {}),
    },
    twitter: {
      card: "summary",
      title: teamName,
      description,
      ...(logo ? { images: [logo] } : {}),
    },
  };
}

export default async function TeamDetailPage({
  params,
}: {
  params: { teamId: string };
}) {
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
  // Roster query: scope to this team_id at the Firestore level, then
  // filter for orphans IN MEMORY. The previous `.where("status",
  // "==", "active")` compound filter broke every SFBL team page
  // because SFBL player docs don't have a status field at all and
  // Firestore equality filters exclude missing fields — audit C1
  // fix (2026-05-15). Predicate matches the captain/admin surfaces:
  //   - active === false   → drop
  //   - orphan === true    → drop (LBDC migration orphans)
  //   - status set and != active → drop (e.g. "unknown")
  //   - missing status     → keep (SFBL legacy)
  const [teamSnap, rosterSnap, gamesSnap, teamsSnap, boxesSnap] = await Promise.all([
    db.doc(`leagues/${tenantId}/teams/${params.teamId}`).get(),
    db
      .collection(`leagues/${tenantId}/players`)
      .where("team_id", "==", params.teamId)
      .get(),
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
    // All box_scores — we use these to compute CURRENT-SEASON per-
    // player stats. The career aggregate on player.stats was the
    // source of the "Bill Crews has 17 GP and a .352 average" bug
    // when the actual spring season only had 5 games played
    // (2026-05-14): recalcLeague writes a career-wide total and the
    // team roster was reading that.
    db.collection(`leagues/${tenantId}/box_scores`).get(),
  ]);
  if (!teamSnap.exists) notFound();

  const t = teamSnap.data() ?? {};
  const teamName = String(t.name ?? params.teamId);
  const division = t.division ? String(t.division) : null;
  const abbrev = t.abbrev ? String(t.abbrev) : undefined;
  const color = t.color ? String(t.color) : undefined;
  const logoUrl = t.logo_url ? String(t.logo_url) : null;

  // Count all-time championships from the historical-standings
  // archive — every playoff block where this team finished
  // undefeated (top of standings, l=0) counts as one bracket win.
  // Match by exact team name (case-insensitive). Tenants without an
  // archive (or franchises that never won) just get 0 → no pill.
  const championships = countChampionships(tenantId, teamName);

  const teamNames: Record<string, { name: string; abbrev?: string; color?: string; logoUrl?: string | null }> = {};
  for (const d of teamsSnap.docs) {
    const data = d.data();
    teamNames[d.id] = {
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
      color: data.color ? String(data.color) : undefined,
      logoUrl: data.logo_url ? String(data.logo_url) : null,
    };
  }

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
  let standings = computeStandings(games);
  const scheme = config?.standings?.points_per ?? null;
  const usePoints = config?.standings?.scoring === "points" && !!scheme;
  if (usePoints && scheme) {
    standings = sortByPoints(standings, scheme, config?.standings?.tiebreaker ?? "rd");
  }
  const myRow = standings.find((r) => r.team_id === params.teamId) ?? null;

  // Standings position WITHIN this team's division. If the league
  // has no division structure, fall back to overall position. Only
  // meaningful when games have actually been played — for fresh
  // launches we hide the rank entirely.
  const hasGames = !!myRow && myRow.w + myRow.l + myRow.t > 0;
  let divisionRank: { rank: number; total: number } | null = null;
  if (hasGames && division) {
    const divPeers = standings.filter((r) => {
      const meta = teamNames[r.team_id];
      // teamNames map is keyed by id; we need the team's division
      // from teamsSnap. Fast inline lookup.
      const peerDoc = teamsSnap.docs.find((d) => d.id === r.team_id);
      return peerDoc && String(peerDoc.data().division ?? "") === division;
    });
    const idx = divPeers.findIndex((r) => r.team_id === params.teamId);
    if (idx >= 0) divisionRank = { rank: idx + 1, total: divPeers.length };
  } else if (hasGames) {
    const idx = standings.findIndex((r) => r.team_id === params.teamId);
    if (idx >= 0) divisionRank = { rank: idx + 1, total: standings.length };
  }

  // Determine the team's CURRENT season — the season_id of the most
  // recent box_score this team appears in. Older seasons' lines
  // (Bill Crews on Tribe in 2024, etc.) sit in box_scores too but
  // shouldn't drive the spring 2026 roster table. Falls back to null
  // when the team has no box_scores yet (pre-launch).
  const teamBoxes = boxesSnap.docs.filter((d) => {
    const b = d.data();
    return (
      String(b.away_team_id ?? "") === params.teamId ||
      String(b.home_team_id ?? "") === params.teamId
    );
  });
  const sortedBoxes = [...teamBoxes].sort((a, b) =>
    String(b.data().date ?? "").localeCompare(String(a.data().date ?? "")),
  );
  const currentSeasonId =
    (sortedBoxes[0]?.data().season_id as string | undefined) ?? null;
  const currentSeasonBoxes = currentSeasonId
    ? teamBoxes.filter(
        (d) => String(d.data().season_id ?? "") === currentSeasonId,
      )
    : [];

  // Per-player current-season aggregator. Walks the team's current-
  // season box_scores, pulls this player's batting + pitching line
  // out of away_lineup/home_lineup/away_pitchers/home_pitchers, and
  // sums. Mirrors the logic in lib/player-profile-data.ts but
  // de-duped for the wider roster-table use case.
  function aggregateForPlayer(playerId: string): {
    bat: ReturnType<typeof emptyBat>;
    pit: ReturnType<typeof emptyPit>;
  } {
    const bat = emptyBat();
    const pit = emptyPit();
    for (const doc of currentSeasonBoxes) {
      const b = doc.data();
      const isAway = String(b.away_team_id ?? "") === params.teamId;
      const lineupKey = isAway ? "away_lineup" : "home_lineup";
      const pitchersKey = isAway ? "away_pitchers" : "home_pitchers";
      const batLine = findPlayerLine(b[lineupKey], playerId);
      if (batLine) {
        bat.gp += 1;
        bat.ab += batLine.ab;
        bat.r += batLine.r;
        bat.h += batLine.h;
        bat.doubles += batLine.doubles;
        bat.triples += batLine.triples;
        bat.hr += batLine.hr;
        bat.rbi += batLine.rbi;
        bat.bb += batLine.bb;
        bat.so += batLine.so;
        bat.sb += batLine.sb;
      }
      const pitchLine = findPlayerLine(b[pitchersKey], playerId);
      if (pitchLine) {
        pit.app += 1;
        pit.ip_outs += pitchLine.ip_outs;
        if (pitchLine.decision === "W") pit.w += 1;
        if (pitchLine.decision === "L") pit.l += 1;
        if (pitchLine.decision === "S") pit.sv += 1;
        pit.h += pitchLine.h;
        pit.r += pitchLine.r;
        pit.er += pitchLine.er;
        pit.bb += pitchLine.bb;
        pit.so += pitchLine.so;
      }
    }
    return { bat, pit };
  }

  // Roster row — current-season stats only. Career stats live on the
  // player profile page (which intentionally spans every season).
  const roster = rosterSnap.docs
    // In-memory orphan filter (see audit C1 — SFBL players have no
    // `status` field at all and would be dropped by a Firestore-level
    // equality filter on "active").
    .filter((d) => {
      const data = d.data();
      if (data.active === false) return false;
      if (data.orphan === true) return false;
      if (data.status && data.status !== "active") return false;
      return true;
    })
    .map((d) => {
      const data = d.data();
      const { bat, pit } = aggregateForPlayer(d.id);
      // Derived: TB (total bases) and rate stats.
      const singles = Math.max(0, bat.h - bat.doubles - bat.triples - bat.hr);
      const tb =
        bat.ab > 0
          ? singles + 2 * bat.doubles + 3 * bat.triples + 4 * bat.hr
          : undefined;
      const avg = bat.ab > 0 ? bat.h / bat.ab : undefined;
      const obp =
        bat.ab + bat.bb > 0
          ? (bat.h + bat.bb) / (bat.ab + bat.bb)
          : undefined;
      const slg = bat.ab > 0 && tb != null ? tb / bat.ab : undefined;
      const ops =
        obp != null && slg != null ? obp + slg : undefined;
      const era =
        pit.ip_outs > 0 ? (pit.er * 27) / pit.ip_outs : undefined;
      const whip =
        pit.ip_outs > 0
          ? ((pit.h + pit.bb) * 3) / pit.ip_outs
          : undefined;
      return {
        id: d.id,
        name: String(data.name ?? d.id),
        // LBDC's migration writes jersey on `number` (mirrors their
        // Supabase column); SFBL captain UI writes it on `jersey`.
        // Read whichever is present so the # column lights up for
        // both. Empty strings ("") fall through to null.
        jersey: jerseyNum(data.jersey ?? data.number),
        position: data.position ? String(data.position) : null,
        // Batting line — undefined when this player has 0 GP this
        // season so the cells render em-dashes instead of zeros.
        gp: bat.gp || undefined,
        ab: bat.gp ? bat.ab : undefined,
        r: bat.gp ? bat.r : undefined,
        h: bat.gp ? bat.h : undefined,
        doubles: bat.gp ? bat.doubles : undefined,
        triples: bat.gp ? bat.triples : undefined,
        hr: bat.gp ? bat.hr : undefined,
        rbi: bat.gp ? bat.rbi : undefined,
        bb: bat.gp ? bat.bb : undefined,
        so: bat.gp ? bat.so : undefined,
        sb: bat.gp ? bat.sb : undefined,
        tb,
        avg,
        obp,
        ops,
        // Pitching — undefined when this player hasn't pitched.
        p_app: pit.app || undefined,
        p_ip_outs: pit.app ? pit.ip_outs : undefined,
        p_w: pit.app ? pit.w : undefined,
        p_l: pit.app ? pit.l : undefined,
        p_sv: pit.app ? pit.sv : undefined,
        p_era: era,
        p_whip: whip,
        p_h: pit.app ? pit.h : undefined,
        p_r: pit.app ? pit.r : undefined,
        p_er: pit.app ? pit.er : undefined,
        p_bb: pit.app ? pit.bb : undefined,
        p_so: pit.app ? pit.so : undefined,
      };
    })
    .sort((a, b) => (a.jersey ?? 999) - (b.jersey ?? 999) || a.name.localeCompare(b.name));

  // Team aggregates — same source as the per-player roster rows.
  const aggBatting = roster.reduce(
    (acc, p) => ({
      gp: acc.gp + (p.gp ?? 0),
      ab: acc.ab + (p.ab ?? 0),
      h: acc.h + (p.h ?? 0),
      r: acc.r + (p.r ?? 0),
      hr: acc.hr + (p.hr ?? 0),
      rbi: acc.rbi + (p.rbi ?? 0),
      avg: 0, // recomputed below
    }),
    { gp: 0, ab: 0, h: 0, r: 0, hr: 0, rbi: 0, avg: 0 },
  );
  aggBatting.avg = aggBatting.ab > 0 ? aggBatting.h / aggBatting.ab : 0;
  const aggPitching = roster.reduce(
    (acc, p) => ({
      app: acc.app + (p.p_app ?? 0),
      ip_outs: acc.ip_outs + (p.p_ip_outs ?? 0),
      er: acc.er + (p.p_er ?? 0),
      era: 0,
    }),
    { app: 0, ip_outs: 0, er: 0, era: 0 },
  );
  aggPitching.era =
    aggPitching.ip_outs > 0
      ? (aggPitching.er * 27) / aggPitching.ip_outs
      : 0;

  // Recent + upcoming games for this team.
  const myGames = gamesSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown> & { id: string })
    .filter((g) => g.home_team_id === params.teamId || g.away_team_id === params.teamId);
  const recentFinals = myGames
    .filter((g) => g.status === "final" || g.status === "approved")
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
    .slice(0, 6);
  const upcoming = myGames
    .filter((g) => g.status === "scheduled")
    .sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")))
    .slice(0, 4);

  return (
    <main>
      {/* Hero band */}
      <section
        className="text-white"
        style={{
          background: `linear-gradient(135deg, ${color ?? "var(--brand-primary)"} 0%, #0a0e1c 80%)`,
        }}
      >
        <div className="container" style={{ padding: "48px 24px" }}>
          <Link
            href="/teams"
            className="font-barlow"
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.7)",
              display: "inline-block",
              marginBottom: 18,
            }}
          >
            ← All Teams
          </Link>
          {/* flex-wrap so the badge + info stack vertically on phones
              instead of forcing horizontal overflow (which would let
              the page swipe-scroll left/right). min-width:0 on the
              info column so long team names don't push past. */}
          <div
            className="flex items-center gap-6"
            style={{ flexWrap: "wrap", minWidth: 0 }}
          >
            <div style={{ background: "white", borderRadius: 16, padding: 14, flexShrink: 0 }}>
              <TeamBadge
                teamId={params.teamId}
                name={teamName}
                initials={abbrev}
                color={color}
                logoUrl={logoUrl}
                size="xl"
              />
            </div>
            <div style={{ minWidth: 0, flex: "1 1 200px" }}>
              {division && (
                <p className="sec-eyebrow" style={{ color: "rgba(255,255,255,0.7)" }}>
                  {division}
                </p>
              )}
              <h1
                className="font-display"
                style={{
                  fontSize: "clamp(32px, 6vw, 72px)",
                  color: "#fff",
                  marginTop: 4,
                  wordBreak: "break-word",
                }}
              >
                {teamName}
              </h1>
              {/* Stats pill row — only shown when there's been at
                  least one game played. Pre-launch shows a "Season
                  starts soon" pill instead so the page doesn't
                  look broken. */}
              {hasGames && myRow ? (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    marginTop: 12,
                  }}
                >
                  <HeroPill
                    primary={formatRecord(myRow.w, myRow.l, myRow.t)}
                    label="Record"
                  />
                  {usePoints && scheme && (
                    <HeroPill
                      primary={String(computePoints(myRow, scheme))}
                      label="Points"
                    />
                  )}
                  <HeroPill
                    primary={
                      myRow.rd > 0
                        ? `+${myRow.rd}`
                        : String(myRow.rd)
                    }
                    label="Run diff"
                  />
                  {divisionRank && (
                    <HeroPill
                      primary={`${ordinal(divisionRank.rank)}`}
                      label={
                        division
                          ? `in ${division}`
                          : `of ${divisionRank.total}`
                      }
                    />
                  )}
                  {championships > 0 && (
                    <HeroPill
                      primary={String(championships)}
                      label={`Title${championships === 1 ? "" : "s"} 🏆`}
                    />
                  )}
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    marginTop: 12,
                    alignItems: "center",
                  }}
                >
                  <p
                    className="font-barlow"
                    style={{
                      display: "inline-block",
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "#fff",
                      background: "rgba(255,255,255,0.12)",
                      padding: "5px 12px",
                      borderRadius: 999,
                      margin: 0,
                    }}
                  >
                    Season starts soon
                  </p>
                  {/* Even pre-season, surface heritage. A team
                      visitor seeing "4 Titles 🏆" before the first
                      game has been played gets a real read on the
                      franchise's history. */}
                  {championships > 0 && (
                    <HeroPill
                      primary={String(championships)}
                      label={`Title${championships === 1 ? "" : "s"} 🏆`}
                    />
                  )}
                </div>
              )}
              <div style={{ marginTop: 14 }}>
                <SubscribeCalendar teamId={params.teamId} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="container py-10">
        {(aggBatting.gp > 0 || aggPitching.app > 0) && (
          <div className="mb-8 grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            {aggBatting.gp > 0 && (
              <>
                <StatTile label="Team AVG" value={formatAvg(aggBatting.avg)} />
                <StatTile label="Runs Scored" value={aggBatting.r} />
                <StatTile label="Home Runs" value={aggBatting.hr} />
              </>
            )}
            {aggPitching.app > 0 && (
              <StatTile label="Team ERA" value={aggPitching.era.toFixed(2)} />
            )}
          </div>
        )}

        {/* Top performers — only shown when there's actual stat data
            on the roster. Surfaces the team's leading batter / power
            hitter / RBI guy in a small card row above the full
            roster table. Helps fans + opposing-team scouts spot
            who's hot. Hidden pre-launch. */}
        {(() => {
          const playersWithStats = roster.filter(
            (p) => p.avg != null || p.hr != null || p.rbi != null,
          );
          if (playersWithStats.length === 0) return null;
          const topAvg = [...playersWithStats]
            .filter((p) => p.avg != null && p.avg > 0)
            .sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0))[0];
          const topHr = [...playersWithStats]
            .filter((p) => p.hr != null && p.hr > 0)
            .sort((a, b) => (b.hr ?? 0) - (a.hr ?? 0))[0];
          const topRbi = [...playersWithStats]
            .filter((p) => p.rbi != null && p.rbi > 0)
            .sort((a, b) => (b.rbi ?? 0) - (a.rbi ?? 0))[0];
          if (!topAvg && !topHr && !topRbi) return null;
          return (
            <div className="mb-8">
              <h2
                className="font-barlow mb-3"
                style={{
                  fontSize: 18,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--brand-primary)",
                }}
              >
                Top Performers
              </h2>
              <div className="grid gap-3 sm:grid-cols-3">
                {topAvg && (
                  <TopPerformerCard
                    label="Batting AVG"
                    value={formatAvg(topAvg.avg ?? 0)}
                    playerId={topAvg.id}
                    playerName={topAvg.name}
                    jersey={topAvg.jersey}
                  />
                )}
                {topHr && (
                  <TopPerformerCard
                    label="Home Runs"
                    value={String(topHr.hr ?? 0)}
                    playerId={topHr.id}
                    playerName={topHr.name}
                    jersey={topHr.jersey}
                  />
                )}
                {topRbi && (
                  <TopPerformerCard
                    label="RBI"
                    value={String(topRbi.rbi ?? 0)}
                    playerId={topRbi.id}
                    playerName={topRbi.name}
                    jersey={topRbi.jersey}
                  />
                )}
              </div>
            </div>
          );
        })()}

        {/* Roster + pitching on the LEFT, schedule/results on the
            RIGHT — side by side like the DVSL team page (Adam, 2026-06;
            it was previously full-width with the schedule below). The
            roster + pitching tables already scroll horizontally
            (overflow-x:auto), so a wide stat table fits in the narrower
            column instead of breaking the page. minmax(0,1fr) lets the
            left column shrink so that overflow can kick in. Collapses
            to one column on phones (roster, then schedule). */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* LEFT — roster (team stats) + pitching */}
          <div style={{ minWidth: 0 }}>
            <h2 className="font-display mb-4" style={{ fontSize: 28 }}>
              Roster
            </h2>
            {roster.length === 0 ? (
              <p style={{ color: "var(--muted)" }}>No players on roster yet.</p>
            ) : (
              <RosterTable roster={roster} hasGames={hasGames} />
            )}

            {/* Pitching table appears only when at least one player on
                the roster has thrown a pitch this season. */}
            {roster.some((p) => (p.p_app ?? 0) > 0) && (
              <div style={{ marginTop: 36 }}>
                <h2 className="font-display mb-4" style={{ fontSize: 28 }}>
                  Pitching
                </h2>
                <div style={{ overflowX: "auto" }}>
                  <PitchingTable roster={roster} />
                </div>
              </div>
            )}
          </div>

          {/* RIGHT — schedule sidebar */}
          <aside style={{ minWidth: 0 }}>
            <h2 className="font-display mb-4" style={{ fontSize: 22 }}>
              Recent Results
            </h2>
            <ul style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recentFinals.length === 0 && (
                <li style={{ color: "var(--muted)", fontSize: 13 }}>
                  No games played yet.
                </li>
              )}
              {recentFinals.map((g) => (
                <GameLine
                  key={g.id}
                  myTeamId={params.teamId}
                  game={g}
                  teams={teamNames}
                />
              ))}
            </ul>
            {upcoming.length > 0 && (
              <>
                <h2 className="font-display mb-3 mt-6" style={{ fontSize: 22 }}>
                  Upcoming
                </h2>
                <ul style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {upcoming.map((g) => (
                    <GameLine
                      key={g.id}
                      myTeamId={params.teamId}
                      game={g}
                      teams={teamNames}
                    />
                  ))}
                </ul>
              </>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}

function TopPerformerCard({
  label,
  value,
  playerId,
  playerName,
  jersey,
}: {
  label: string;
  value: string;
  playerId: string;
  playerName: string;
  jersey: number | null;
}) {
  return (
    <Link
      href={`/players/${playerId}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 14px",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        textDecoration: "none",
        color: "inherit",
        transition: "transform 120ms ease, box-shadow 120ms ease",
      }}
    >
      <div
        className="font-barlow"
        style={{
          fontSize: 28,
          fontWeight: 900,
          color: "var(--brand-primary)",
          letterSpacing: "-0.02em",
          lineHeight: 1,
          minWidth: 50,
          textAlign: "center",
        }}
      >
        {value}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sec-eyebrow" style={{ marginBottom: 2 }}>
          {label}
        </div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text-strong)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {jersey != null ? `#${jersey} ` : ""}
          {playerName}
        </div>
      </div>
    </Link>
  );
}

interface RosterPlayer {
  id: string;
  name: string;
  jersey: number | null;
  position: string | null;
  // Batting
  gp?: number;
  ab?: number;
  r?: number;
  h?: number;
  doubles?: number;
  triples?: number;
  hr?: number;
  rbi?: number;
  bb?: number;
  so?: number;
  sb?: number;
  tb?: number;
  avg?: number;
  obp?: number;
  ops?: number;
  // Pitching
  p_app?: number;
  p_ip_outs?: number;
  p_w?: number;
  p_l?: number;
  p_sv?: number;
  p_era?: number;
  p_whip?: number;
  p_h?: number;
  p_r?: number;
  p_er?: number;
  p_bb?: number;
  p_so?: number;
}

function RosterTable({
  roster,
  hasGames,
}: {
  roster: RosterPlayer[];
  hasGames: boolean;
}) {
  // Pre-season: bare #/name/pos. The all-em-dash stat table looked
  // broken on launch day, so we hide stat columns until the first
  // box score lands.
  if (!hasGames) {
    return (
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <table className="s-tbl">
          <thead>
            <tr>
              <th className="text-left">#</th>
              <th className="text-left">Player</th>
              <th className="text-left">Pos</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((p) => (
              <tr key={p.id}>
                <td className="text-left">
                  <span className="rank">{p.jersey ?? "—"}</span>
                </td>
                <td className="text-left">
                  <Link href={`/players/${p.id}`} style={{ fontWeight: 600 }}>
                    {p.name}
                  </Link>
                </td>
                <td className="text-left">
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>
                    {p.position ?? "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  // Batting table — trimmed to the columns the DVSL team page shows
  // so it fits beside the schedule sidebar (Adam, 2026-06): # / Player
  // / AB / R / H / 2B / 3B / HR / RBI / BB / AVG / OBP / OPS. Dropped
  // GP / K / SB / TB (secondary stats the reference doesn't show). Pos
  // is also dropped on the full table — players move around. Still
  // overflow-x:auto so it can pan on a phone if it gets tight.
  return (
    <div
      className="rounded-md border border-slate-200 bg-white"
      style={{ overflowX: "auto" }}
    >
      <table className="s-tbl" style={{ minWidth: 700 }}>
        <thead>
          <tr>
            <th className="text-left">#</th>
            <th className="text-left">Player</th>
            <th>AB</th>
            <th>R</th>
            <th>H</th>
            <th>2B</th>
            <th>3B</th>
            <th>HR</th>
            <th>RBI</th>
            <th>BB</th>
            <th>AVG</th>
            <th>OBP</th>
            <th>OPS</th>
          </tr>
        </thead>
        <tbody>
          {roster.map((p) => (
            <tr key={p.id}>
              <td className="text-left">
                <span className="rank">{p.jersey ?? "—"}</span>
              </td>
              <td className="text-left">
                <Link href={`/players/${p.id}`} style={{ fontWeight: 600 }}>
                  {p.name}
                </Link>
              </td>
              <td>{p.ab ?? "—"}</td>
              <td>{p.r ?? "—"}</td>
              <td>{p.h ?? "—"}</td>
              <td>{p.doubles ?? "—"}</td>
              <td>{p.triples ?? "—"}</td>
              <td>{p.hr ?? "—"}</td>
              <td>{p.rbi ?? "—"}</td>
              <td>{p.bb ?? "—"}</td>
              <td>{p.avg != null ? formatAvg(p.avg) : "—"}</td>
              <td>{p.obp != null ? formatAvg(p.obp) : "—"}</td>
              <td>{p.ops != null ? formatOps(p.ops) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Pitching table — same data shape as RosterPlayer (we attached the
// pitching aggregate alongside batting), filtered to players with at
// least one appearance. Columns: Player / APP / IP / W / L / SV /
// ERA / WHIP / H / R / ER / BB / K. Hidden entirely when no one on
// the team has pitched yet (we gate at the call site).
function PitchingTable({ roster }: { roster: RosterPlayer[] }) {
  const pitchers = roster
    .filter((p) => (p.p_app ?? 0) > 0)
    .sort((a, b) => {
      // Sort by IP desc (more innings → higher in the table). Tie-
      // break by ERA asc (lower is better) then by name.
      const ipa = a.p_ip_outs ?? 0;
      const ipb = b.p_ip_outs ?? 0;
      if (ipa !== ipb) return ipb - ipa;
      const ea = a.p_era ?? 99;
      const eb = b.p_era ?? 99;
      if (ea !== eb) return ea - eb;
      return a.name.localeCompare(b.name);
    });

  if (pitchers.length === 0) return null;

  return (
    <div
      className="rounded-md border border-slate-200 bg-white"
      style={{ overflowX: "auto" }}
    >
      <table className="s-tbl" style={{ minWidth: 900 }}>
        <thead>
          <tr>
            <th className="text-left">Player</th>
            <th>APP</th>
            <th>IP</th>
            <th>W</th>
            <th>L</th>
            <th>SV</th>
            <th>ERA</th>
            <th>WHIP</th>
            <th>H</th>
            <th>R</th>
            <th>ER</th>
            <th>BB</th>
            <th>K</th>
          </tr>
        </thead>
        <tbody>
          {pitchers.map((p) => (
            <tr key={p.id}>
              <td className="text-left">
                <Link href={`/players/${p.id}`} style={{ fontWeight: 600 }}>
                  {p.name}
                </Link>
              </td>
              <td>{p.p_app ?? "—"}</td>
              <td>
                {p.p_ip_outs != null ? formatIP(p.p_ip_outs) : "—"}
              </td>
              <td>{p.p_w ?? "—"}</td>
              <td>{p.p_l ?? "—"}</td>
              <td>{p.p_sv ?? "—"}</td>
              <td>{p.p_era != null ? p.p_era.toFixed(2) : "—"}</td>
              <td>{p.p_whip != null ? p.p_whip.toFixed(2) : "—"}</td>
              <td>{p.p_h ?? "—"}</td>
              <td>{p.p_r ?? "—"}</td>
              <td>{p.p_er ?? "—"}</td>
              <td>{p.p_bb ?? "—"}</td>
              <td>{p.p_so ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeroPill({
  primary,
  label,
}: {
  primary: string;
  label: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "8px 14px",
        background: "rgba(255,255,255,0.12)",
        borderRadius: 10,
        minWidth: 64,
      }}
    >
      <span
        className="font-barlow"
        style={{
          fontSize: 22,
          fontWeight: 900,
          color: "#fff",
          lineHeight: 1,
          letterSpacing: "-0.01em",
        }}
      >
        {primary}
      </span>
      <span
        className="font-barlow"
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.7)",
          marginTop: 2,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function ordinal(n: number): string {
  // 1 → 1st, 2 → 2nd, 3 → 3rd, 4 → 4th, 11/12/13 → 11th/12th/13th, etc.
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  const suffix = s[(v - 20) % 10] ?? s[v] ?? "th";
  return n + suffix;
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
        textAlign: "center",
      }}
    >
      <div className="sec-eyebrow">{label}</div>
      <div
        className="font-barlow"
        style={{ fontSize: 36, fontWeight: 900, color: "var(--brand-primary)", lineHeight: 1, marginTop: 4 }}
      >
        {value}
      </div>
    </div>
  );
}

function GameLine({
  myTeamId,
  game,
  teams,
}: {
  myTeamId: string;
  game: Record<string, unknown> & { id: string };
  teams: Record<string, { name: string; abbrev?: string; color?: string; logoUrl?: string | null }>;
}) {
  const isHome = game.home_team_id === myTeamId;
  const opponentId = String(isHome ? game.away_team_id : game.home_team_id);
  const opp = teams[opponentId];
  const myScore = Number(isHome ? game.home_score : game.away_score);
  const oppScore = Number(isHome ? game.away_score : game.home_score);
  const status = String(game.status ?? "");
  const isFinal = status === "final" || status === "approved";
  const won = isFinal && myScore > oppScore;
  const lost = isFinal && myScore < oppScore;
  // Audit H1: date-only strings must render as a stable local
  // calendar day (was slipping a day for LBDC's Pacific users).
  const dateStr = formatGameDate(
    game.date ? String(game.date) : null,
    game.time ? String(game.time) : null,
    { month: "short", day: "numeric" },
  );

  return (
    <li>
      <Link
        href={`/games/${game.id}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          border: "1px solid var(--border)",
          borderRadius: 10,
          background: "var(--card)",
          fontSize: 13,
        }}
      >
        <span
          className="font-barlow"
          style={{
            fontSize: 11,
            fontWeight: 800,
            width: 22,
            textAlign: "center",
            color: won ? "var(--green)" : lost ? "var(--red)" : "var(--muted)",
          }}
        >
          {won ? "W" : lost ? "L" : "·"}
        </span>
        <span style={{ color: "var(--muted)" }}>{isHome ? "vs" : "@"}</span>
        {opp?.logoUrl && (
          <TeamBadge
            teamId={opponentId}
            name={opp.name}
            initials={opp.abbrev}
            color={opp.color}
            logoUrl={opp.logoUrl}
            size="sm"
          />
        )}
        <span style={{ flex: 1, fontWeight: 600 }}>{opp?.name ?? opponentId}</span>
        <span style={{ fontFamily: "var(--font-barlow)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {isFinal ? `${myScore}–${oppScore}` : dateStr || status}
        </span>
      </Link>
    </li>
  );
}

function formatRecord(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}
function formatAvg(n: number): string {
  if (n === 1) return "1.000";
  return n.toFixed(3).replace(/^0/, "");
}
// OPS can exceed 1.000 (a great year). Keep the leading 1 in that
// case ("1.778"); strip the leading zero only when ≤ 1.000 ("0.456"
// → ".456").
function formatOps(n: number): string {
  const s = n.toFixed(3);
  return n < 1 ? s.replace(/^0/, "") : s;
}

// Coerce an arbitrary jersey value to a number, returning null when
// the input is empty / non-numeric. Handles LBDC's string-encoded
// numbers ("13") and SFBL's actual numbers (13). Leading zero is
// preserved as-is at the display layer, but for sorting we want
// numeric.
function jerseyNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (s === "" || s === "—" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Per-player accumulators for the on-the-fly current-season
// aggregation. Returning an object with explicit `gp`/`app` lets the
// caller cheaply distinguish "played 0 games" from "never appeared"
// at the cell-render level (where we want em-dashes, not zeros).
function emptyBat() {
  return {
    gp: 0,
    ab: 0,
    r: 0,
    h: 0,
    doubles: 0,
    triples: 0,
    hr: 0,
    rbi: 0,
    bb: 0,
    so: 0,
    sb: 0,
  };
}
function emptyPit() {
  return {
    app: 0,
    ip_outs: 0,
    w: 0,
    l: 0,
    sv: 0,
    h: 0,
    r: 0,
    er: 0,
    bb: 0,
    so: 0,
  };
}

// Pull a single player's batting OR pitching line out of an
// away_lineup / home_lineup / away_pitchers / home_pitchers array.
// Returns null when the player wasn't in that side of the box.
function findPlayerLine(arr: unknown, playerId: string) {
  if (!Array.isArray(arr)) return null;
  for (const r of arr as Array<Record<string, unknown>>) {
    if (String(r.player_id ?? "") !== playerId) continue;
    return {
      // Batting fields
      ab: Number(r.ab ?? 0),
      r: Number(r.r ?? 0),
      h: Number(r.h ?? 0),
      doubles: Number(r.doubles ?? 0),
      triples: Number(r.triples ?? 0),
      hr: Number(r.hr ?? 0),
      rbi: Number(r.rbi ?? 0),
      bb: Number(r.bb ?? 0),
      so: Number(r.so ?? r.k ?? 0),
      sb: Number(r.sb ?? 0),
      // Pitching fields
      ip_outs: Number(r.ip_outs ?? 0),
      er: Number(r.er ?? 0),
      decision:
        r.decision === "W" || r.decision === "L" || r.decision === "S"
          ? (r.decision as "W" | "L" | "S")
          : undefined,
    };
  }
  return null;
}

// All-time championship count for this team. Reads the historical
// standings archive at data/{tenantId}/historical-standings.json,
// scans every playoff block, and counts entries where this team
// was the undefeated top finisher (i.e. won the bracket).
//
// File-based cache: Next's force-dynamic rendering re-reads on
// every request, but the archive is small (256KB for SFBL's 23
// years) and JSON.parse is fast. No network round-trip.
//
// Returns 0 if the archive doesn't exist (other tenants) or the
// team name doesn't appear in any playoff block.
function countChampionships(tenantId: string, teamName: string): number {
  const file = path.resolve(
    process.cwd(),
    `data/${tenantId}/historical-standings.json`,
  );
  if (!fs.existsSync(file)) return 0;
  let archive: Array<{
    game_type: string;
    standings: Array<{ team: string; l: number }>;
  }>;
  try {
    archive = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return 0;
  }
  // Closes audit M2. Validate each block's shape defensively. The
  // try/catch above covers JSON.parse failure, but a row with
  // `standings: null` (or missing fields) used to crash the server
  // component with TypeError on `.length`, turning every visit to
  // /teams/<id> into a 500.
  if (!Array.isArray(archive)) return 0;
  const lowered = teamName.trim().toLowerCase();
  let count = 0;
  for (const block of archive) {
    if (!block || typeof block !== "object") continue;
    if (block.game_type !== "playoff") continue;
    if (!Array.isArray(block.standings) || block.standings.length === 0) {
      continue;
    }
    const top = block.standings[0];
    if (!top || typeof top !== "object") continue;
    if (top.l !== 0) continue; // not an undefeated bracket winner
    if (typeof top.team !== "string") continue;
    if (top.team.trim().toLowerCase() === lowered) count++;
  }
  return count;
}

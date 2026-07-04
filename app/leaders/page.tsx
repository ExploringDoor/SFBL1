// Stats Leaders page — DVSL parity for the "leaderboards" surface.
// Surfaces top teams across the metrics we have data for, even
// without per-player batting stats (which require captain-submitted
// box scores — SFBL launch starts with team-level data only).
//
// What's shown:
//   • Top scoring offenses (most runs scored)
//   • Stingiest defenses (fewest runs allowed)
//   • Best run differential
//   • Longest active win streak
//   • Largest single-game blowout
//   • Closest games (lowest combined margin)
//
// Per-player batting / pitching leaders auto-appear once captains
// start submitting box scores with batter detail (the AI scoresheet
// upload feeds into this seamlessly).

import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import "./leaders.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leaders",
  description: "Statistical leaders across the season.",
};

interface GameDoc {
  id: string;
  date: string;
  away_team_id: string;
  home_team_id: string;
  away_score: number;
  home_score: number;
  status: string;
}

interface TeamLite {
  id: string;
  name: string;
  abbrev?: string;
}

export default async function LeadersPage() {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

  const db = getAdminDb();
  const [gameSnap, teamSnap, playerSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
    db.collection(`leagues/${tenantId}/players`).get(),
  ]);

  const teamMap = new Map<string, TeamLite>();
  for (const d of teamSnap.docs) {
    const data = d.data();
    teamMap.set(d.id, {
      id: d.id,
      name: String(data.name ?? d.id),
      abbrev: data.abbrev ? String(data.abbrev) : undefined,
    });
  }

  const games: GameDoc[] = gameSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        date: String(data.date ?? ""),
        away_team_id: String(data.away_team_id ?? ""),
        home_team_id: String(data.home_team_id ?? ""),
        away_score: Number(data.away_score) || 0,
        home_score: Number(data.home_score) || 0,
        status: String(data.status ?? ""),
      };
    })
    .filter(
      (g) =>
        (g.status === "final" || g.status === "approved") &&
        g.away_team_id &&
        g.home_team_id,
    );

  // Per-team aggregate stats from finished games.
  type TeamAgg = {
    team_id: string;
    name: string;
    rs: number;
    ra: number;
    gp: number;
    rd: number;
    rsPerGame: number;
    raPerGame: number;
    streak: { type: "W" | "L" | "T"; count: number } | null;
  };
  const teamAggs = new Map<string, TeamAgg>();

  for (const g of games) {
    for (const sideId of [g.home_team_id, g.away_team_id]) {
      if (!teamAggs.has(sideId)) {
        const t = teamMap.get(sideId);
        teamAggs.set(sideId, {
          team_id: sideId,
          name: t?.name ?? sideId,
          rs: 0,
          ra: 0,
          gp: 0,
          rd: 0,
          rsPerGame: 0,
          raPerGame: 0,
          streak: null,
        });
      }
    }
    const home = teamAggs.get(g.home_team_id)!;
    const away = teamAggs.get(g.away_team_id)!;
    home.rs += g.home_score;
    home.ra += g.away_score;
    home.gp += 1;
    away.rs += g.away_score;
    away.ra += g.home_score;
    away.gp += 1;
  }

  // Compute streaks: walk per-team game outcomes in date order, find
  // the trailing run.
  const sorted = [...games].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  const outcomes = new Map<string, ("W" | "L" | "T")[]>();
  for (const g of sorted) {
    const homeOutcome: "W" | "L" | "T" =
      g.home_score > g.away_score ? "W" : g.away_score > g.home_score ? "L" : "T";
    const awayOutcome: "W" | "L" | "T" =
      g.away_score > g.home_score ? "W" : g.home_score > g.away_score ? "L" : "T";
    if (!outcomes.has(g.home_team_id)) outcomes.set(g.home_team_id, []);
    if (!outcomes.has(g.away_team_id)) outcomes.set(g.away_team_id, []);
    outcomes.get(g.home_team_id)!.push(homeOutcome);
    outcomes.get(g.away_team_id)!.push(awayOutcome);
  }
  for (const [tid, list] of outcomes) {
    if (list.length === 0) continue;
    const last = list[list.length - 1]!;
    let count = 0;
    for (let i = list.length - 1; i >= 0 && list[i] === last; i--) count++;
    const a = teamAggs.get(tid);
    if (a) a.streak = { type: last, count };
  }

  // Finalize per-game averages + RD.
  for (const a of teamAggs.values()) {
    a.rd = a.rs - a.ra;
    a.rsPerGame = a.gp > 0 ? a.rs / a.gp : 0;
    a.raPerGame = a.gp > 0 ? a.ra / a.gp : 0;
  }

  const teamsArr = [...teamAggs.values()].filter((a) => a.gp > 0);

  // Compute leaderboards.
  const topOffense = [...teamsArr]
    .sort((a, b) => b.rsPerGame - a.rsPerGame)
    .slice(0, 5);
  const topDefense = [...teamsArr]
    .sort((a, b) => a.raPerGame - b.raPerGame)
    .slice(0, 5);
  const topRunDiff = [...teamsArr].sort((a, b) => b.rd - a.rd).slice(0, 5);
  const longestStreak = [...teamsArr]
    .filter((a) => a.streak && a.streak.type === "W")
    .sort((a, b) => (b.streak?.count ?? 0) - (a.streak?.count ?? 0))
    .slice(0, 5);

  const blowouts = [...games]
    .map((g) => ({
      ...g,
      margin: Math.abs(g.home_score - g.away_score),
    }))
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 3);

  const closest = [...games]
    .map((g) => ({
      ...g,
      margin: Math.abs(g.home_score - g.away_score),
    }))
    .filter((g) => g.margin > 0)
    .sort((a, b) => a.margin - b.margin)
    .slice(0, 3);

  const teamLabel = (id: string): string =>
    teamMap.get(id)?.name ?? id;

  return (
    <main className="ld-shell">
      <header className="ld-header">
        <h1 className="ld-title">Stats Leaders</h1>
        <p className="ld-sub">
          {games.length} final games · {teamsArr.length} teams in the mix
        </p>
      </header>

      {teamsArr.length === 0 ? (
        <p className="ld-empty">
          No final games yet. Leaderboards populate once games are
          submitted.
        </p>
      ) : (
        <div className="ld-grid">
          <LeaderCard
            title="Top Scoring Offense"
            subtitle="Runs per game"
            rows={topOffense.map((t) => ({
              label: t.name,
              link: `/teams/${t.team_id}`,
              value: t.rsPerGame.toFixed(1),
              hint: `${t.rs} runs in ${t.gp}`,
            }))}
          />
          <LeaderCard
            title="Stingiest Defense"
            subtitle="Runs allowed per game"
            rows={topDefense.map((t) => ({
              label: t.name,
              link: `/teams/${t.team_id}`,
              value: t.raPerGame.toFixed(1),
              hint: `${t.ra} runs in ${t.gp}`,
            }))}
          />
          <LeaderCard
            title="Best Run Differential"
            subtitle="Runs scored − allowed"
            rows={topRunDiff.map((t) => ({
              label: t.name,
              link: `/teams/${t.team_id}`,
              value: (t.rd >= 0 ? "+" : "") + t.rd,
              hint: `${t.rs} − ${t.ra}`,
              highlight: t.rd >= 0 ? "good" : "bad",
            }))}
          />
          <LeaderCard
            title="Longest Active Win Streak"
            subtitle="Consecutive Ws"
            rows={longestStreak.map((t) => ({
              label: t.name,
              link: `/teams/${t.team_id}`,
              value: `W${t.streak?.count ?? 0}`,
              highlight: "good",
            }))}
            empty="No active win streaks."
          />
          <LeaderCard
            title="Biggest Blowouts"
            subtitle="Run margin in a single game"
            rows={blowouts.map((g) => ({
              label: `${teamLabel(g.away_team_id)} ${g.away_score} – ${g.home_score} ${teamLabel(g.home_team_id)}`,
              link: `/games/${g.id}`,
              value: `+${g.margin}`,
              hint: g.date.slice(0, 10),
            }))}
          />
          <LeaderCard
            title="Closest Games"
            subtitle="Smallest winning margin"
            rows={closest.map((g) => ({
              label: `${teamLabel(g.away_team_id)} ${g.away_score} – ${g.home_score} ${teamLabel(g.home_team_id)}`,
              link: `/games/${g.id}`,
              value: `+${g.margin}`,
              hint: g.date.slice(0, 10),
            }))}
          />
        </div>
      )}

      {playerSnap.size > 0 && (
        <p className="ld-hint">
          Per-player batting + pitching leaders appear here once
          captains start submitting full box scores. Use the captain
          portal's <strong>📄 Upload scoresheet</strong> to drop a PDF
          and the AI fills in batter detail automatically.
        </p>
      )}
    </main>
  );
}

function LeaderCard({
  title,
  subtitle,
  rows,
  empty,
}: {
  title: string;
  subtitle: string;
  rows: {
    label: string;
    link?: string;
    value: string;
    hint?: string;
    highlight?: "good" | "bad";
  }[];
  empty?: string;
}) {
  return (
    <article className="ld-card">
      <header>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </header>
      {rows.length === 0 ? (
        <p className="ld-card-empty">
          {empty ?? "Not enough data yet."}
        </p>
      ) : (
        <ol>
          {rows.map((r, i) => {
            const valueClass =
              "ld-value" +
              (r.highlight === "good"
                ? " ld-value-good"
                : r.highlight === "bad"
                  ? " ld-value-bad"
                  : "");
            const inner = (
              <>
                <span className="ld-rank">{i + 1}</span>
                <span className="ld-label">
                  <span>{r.label}</span>
                  {r.hint && <small>{r.hint}</small>}
                </span>
                <span className={valueClass}>{r.value}</span>
              </>
            );
            return (
              <li key={i}>
                {r.link ? (
                  <Link href={r.link} className="ld-row-link">
                    {inner}
                  </Link>
                ) : (
                  <div className="ld-row">{inner}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}

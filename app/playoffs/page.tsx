// Public playoff bracket page. Renders the bracket admin defined
// at /admin → Playoffs. Auto-hides when bracket.active is false
// (e.g. regular season — no playoff data to show).

import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import "./playoffs.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Playoffs",
  description: "Playoff bracket and results.",
};

interface Match {
  id: string;
  away_team_id: string | null;
  away_seed: number | null;
  home_team_id: string | null;
  home_seed: number | null;
  game_id: string | null;
  away_score: number | null;
  home_score: number | null;
  winner_team_id: string | null;
  status: "scheduled" | "live" | "final";
}

interface Round {
  label: string;
  matches: Match[];
}

interface Division {
  label: string;
  rounds: Round[];
}

interface Bracket {
  active: boolean;
  title: string;
  divisions: Division[];
}

export default async function PlayoffsPage() {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

  const db = getAdminDb();
  const [bracketSnap, teamSnap] = await Promise.all([
    db.doc(`leagues/${tenantId}/site_config/playoffs`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
  ]);

  const bracket: Bracket | null = bracketSnap.exists
    ? ((bracketSnap.data() as Partial<Bracket>) ?? null) &&
      ({
        active: bracketSnap.data()?.active === true,
        title: String(bracketSnap.data()?.title ?? "Playoffs"),
        divisions: (bracketSnap.data()?.divisions ?? []) as Division[],
      } as Bracket)
    : null;

  if (!bracket || !bracket.active) {
    return (
      <main className="po-shell">
        <header className="po-header">
          <h1 className="po-title">Playoffs</h1>
          <p className="po-empty">
            Playoff bracket isn't published yet. Check back later in the
            season.
          </p>
        </header>
      </main>
    );
  }

  const teamLabel = (id: string | null): string => {
    if (!id) return "TBD";
    const t = teamSnap.docs.find((d) => d.id === id);
    return t ? String(t.data().name ?? id) : id;
  };

  return (
    <main className="po-shell">
      <header className="po-header">
        <h1 className="po-title">{bracket.title}</h1>
      </header>

      {bracket.divisions.length === 0 ? (
        <p className="po-empty">No divisions configured.</p>
      ) : (
        bracket.divisions.map((div, di) => (
          <section key={di} className="po-division">
            <h2 className="po-div-label">{div.label || `Division ${di + 1}`}</h2>
            <div className="po-rounds">
              {div.rounds.map((round, ri) => (
                <div key={ri} className="po-round">
                  <h3 className="po-round-label">{round.label}</h3>
                  <div className="po-matches">
                    {round.matches.map((m) => (
                      <MatchCard
                        key={m.id}
                        match={m}
                        teamLabel={teamLabel}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}

function MatchCard({
  match,
  teamLabel,
}: {
  match: Match;
  teamLabel: (id: string | null) => string;
}) {
  const isLive = match.status === "live";
  const isFinal = match.status === "final";
  const awayName = teamLabel(match.away_team_id);
  const homeName = teamLabel(match.home_team_id);
  const awayWon =
    match.winner_team_id != null &&
    match.winner_team_id === match.away_team_id;
  const homeWon =
    match.winner_team_id != null &&
    match.winner_team_id === match.home_team_id;

  const inner = (
    <article className={`po-match ${isLive ? "po-match-live" : ""} ${isFinal ? "po-match-final" : ""}`}>
      {isLive && (
        <span className="po-match-status po-match-status-live">
          <span className="po-match-dot" />
          LIVE
        </span>
      )}
      {isFinal && <span className="po-match-status po-match-status-final">FINAL</span>}

      <div className={"po-team " + (awayWon ? "po-team-win" : isFinal ? "po-team-loss" : "")}>
        <span className="po-seed">{match.away_seed ? `#${match.away_seed}` : ""}</span>
        <span className="po-team-name">{awayName}</span>
        {(match.away_score != null || isFinal || isLive) && (
          <span className="po-score">{match.away_score ?? "—"}</span>
        )}
      </div>
      <div className={"po-team " + (homeWon ? "po-team-win" : isFinal ? "po-team-loss" : "")}>
        <span className="po-seed">{match.home_seed ? `#${match.home_seed}` : ""}</span>
        <span className="po-team-name">{homeName}</span>
        {(match.home_score != null || isFinal || isLive) && (
          <span className="po-score">{match.home_score ?? "—"}</span>
        )}
      </div>
    </article>
  );

  return match.game_id ? (
    <Link href={`/games/${match.game_id}`} className="po-match-link">
      {inner}
    </Link>
  ) : (
    inner
  );
}

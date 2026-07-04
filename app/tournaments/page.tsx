// /tournaments — public tournament directory. Tenant-scoped: reads
// /leagues/<id>/site_config/tournament_meta for the admin-defined
// tournament order + locations, and /leagues/<id>/tournament_games
// for any scheduled games per tournament. Mirrors LBDC's
// TournamentsPage (src/App.jsx line 2141) — a separate surface
// from the regular /schedule because tournaments are concurrent
// multi-day events, not a per-team weekly slate.
//
// Empty-state when a tenant has no tournament data (most leagues
// don't run tournaments). LBDC's data lives at:
//   /leagues/<id>/tournament_games/<id>
//   /leagues/<id>/site_config/tournament_meta = { data: [{name, location}] }

import type { Metadata } from "next";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tournaments",
  description: "Tournament schedules and locations.",
};

interface TournamentMeta {
  name: string;
  location?: string;
}

interface TournamentGame {
  id: string;
  tournament_name: string;
  date: string;
  time: string;
  field: string | null;
  away_team_id: string;
  home_team_id: string;
  notes: string;
}

async function loadTournaments(tenantId: string): Promise<{
  meta: TournamentMeta[];
  games: TournamentGame[];
}> {
  const db = getAdminDb();
  const [metaSnap, gamesSnap] = await Promise.all([
    db.doc(`leagues/${tenantId}/site_config/tournament_meta`).get(),
    db.collection(`leagues/${tenantId}/tournament_games`).get(),
  ]);

  const metaArr =
    (metaSnap.exists && (metaSnap.data()?.data as TournamentMeta[])) || [];

  const games: TournamentGame[] = gamesSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      tournament_name: String(data.tournament_name ?? ""),
      date: String(data.date ?? ""),
      time: String(data.time ?? ""),
      field: data.field ? String(data.field) : null,
      away_team_id: String(data.away_team_id ?? ""),
      home_team_id: String(data.home_team_id ?? ""),
      notes: String(data.notes ?? ""),
    };
  });

  return { meta: metaArr, games };
}

function formatDate(yyyyMmDd: string): string {
  if (!yyyyMmDd) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(yyyyMmDd);
  if (!m) return yyyyMmDd;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return yyyyMmDd;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function TournamentsPage() {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

  const { meta, games } = await loadTournaments(tenantId);

  // Group games by tournament name.
  const byTournament = new Map<string, TournamentGame[]>();
  for (const g of games) {
    if (!byTournament.has(g.tournament_name))
      byTournament.set(g.tournament_name, []);
    byTournament.get(g.tournament_name)!.push(g);
  }

  // Display order: meta order first, then any tournament that has
  // games but isn't in meta (alpha by name).
  const metaNames = meta.map((m) => m.name);
  const extraNames = [...byTournament.keys()]
    .filter((n) => !metaNames.includes(n))
    .sort((a, b) => a.localeCompare(b));
  const orderedNames = [...metaNames, ...extraNames];

  const orderedTournaments = orderedNames
    .map((name) => ({
      name,
      location: meta.find((m) => m.name === name)?.location ?? "",
      games: (byTournament.get(name) ?? [])
        .filter((g) => g.notes !== "__placeholder__")
        .sort((a, b) => {
          if (a.date !== b.date) return a.date < b.date ? -1 : 1;
          return a.time.localeCompare(b.time);
        }),
      // A tournament can appear in meta but have only the
      // __placeholder__ row in tournament_games (admin set up the
      // tournament before scheduling games). Show with "TBD" copy.
      hasGames: (byTournament.get(name) ?? []).some(
        (g) => g.notes !== "__placeholder__",
      ),
    }))
    .filter((t) => meta.some((m) => m.name === t.name) || t.games.length > 0);

  if (orderedTournaments.length === 0) {
    return (
      <main className="container py-10">
        <header className="mb-6">
          <h1
            className="font-display"
            style={{
              fontSize: "clamp(40px, 6vw, 64px)",
              lineHeight: 0.95,
              color: "var(--text-strong)",
              margin: 0,
            }}
          >
            Tournaments
          </h1>
        </header>
        <div
          style={{
            padding: "32px 24px",
            background: "rgba(0,0,0,0.03)",
            border: "1px dashed rgba(0,0,0,0.12)",
            borderRadius: 12,
            textAlign: "center",
            color: "var(--muted)",
            lineHeight: 1.55,
            maxWidth: 600,
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 8 }}>🏆</div>
          <strong style={{ color: "var(--brand-primary)" }}>
            No tournaments posted yet
          </strong>
          <p style={{ margin: "8px 0 0", fontSize: 14 }}>
            Tournament schedules and brackets will appear here as the
            league posts them.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="container py-10">
      <header className="mb-8">
        <p className="sec-eyebrow" style={{ color: "var(--brand-primary)" }}>
          Diamond Classics
        </p>
        <h1
          className="font-display"
          style={{
            fontSize: "clamp(40px, 6vw, 64px)",
            lineHeight: 0.95,
            color: "var(--text-strong)",
            margin: 0,
          }}
        >
          Tournaments
        </h1>
        <p style={{ marginTop: 8, color: "var(--muted)", maxWidth: 680 }}>
          Schedules + brackets for every tournament this season.
        </p>
      </header>

      <div className="space-y-10">
        {orderedTournaments.map((t) => (
          <section
            key={t.name}
            style={{
              background: "white",
              border: "1px solid rgba(0,0,0,0.08)",
              borderRadius: 14,
              padding: "20px 22px",
            }}
          >
            <header style={{ marginBottom: 14 }}>
              <h2
                className="font-display"
                style={{
                  margin: 0,
                  fontSize: 22,
                  color: "var(--text-strong)",
                  letterSpacing: "-0.01em",
                  lineHeight: 1.2,
                }}
              >
                {t.name}
              </h2>
              {t.location && (
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 13,
                    color: "var(--muted)",
                  }}
                >
                  📍 {t.location}
                </p>
              )}
            </header>

            {t.games.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: "var(--muted)",
                  fontStyle: "italic",
                }}
              >
                Schedule coming soon.
              </p>
            ) : (
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {t.games.map((g) => (
                  <li
                    key={g.id}
                    style={{
                      background: "rgba(0,0,0,0.025)",
                      border: "1px solid rgba(0,0,0,0.05)",
                      borderRadius: 10,
                      padding: "10px 14px",
                      display: "grid",
                      gridTemplateColumns: "120px 1fr",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--brand-primary)",
                      }}
                    >
                      {formatDate(g.date) || "TBD"}
                      {g.time && (
                        <span
                          style={{
                            display: "block",
                            fontWeight: 500,
                            color: "var(--muted)",
                            fontSize: 12,
                          }}
                        >
                          {g.time}
                        </span>
                      )}
                    </div>
                    <div>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 14,
                          color: "var(--text-strong)",
                        }}
                      >
                        {g.away_team_id || "TBD"} @ {g.home_team_id || "TBD"}
                      </div>
                      {g.field && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--muted)",
                            marginTop: 2,
                          }}
                        >
                          {g.field}
                        </div>
                      )}
                      {g.notes && g.notes !== "__placeholder__" && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--muted)",
                            marginTop: 2,
                            fontStyle: "italic",
                          }}
                        >
                          {g.notes}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}

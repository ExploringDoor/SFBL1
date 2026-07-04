// /availability — standalone "mark your RSVP" page. Tenant-scoped.
// No sign-in required: pick your team → pick your name → mark
// yes/maybe/no per upcoming game. Mirrors LBDC's PlayerAvailability
// flow (src/App.jsx line 8794). The platform's /profile#avail
// surface still exists for signed-in players; this is the
// no-auth alternative that LBDC's commissioner wanted.
//
// Server-rendered shell: loads teams + their rosters + upcoming
// games + existing RSVPs. Client component handles the picker UI
// and POSTs to /api/public-rsvp.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { AvailabilityPicker } from "@/components/AvailabilityPicker";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Availability",
  description: "Mark your availability for upcoming games.",
};

interface TeamRow {
  id: string;
  name: string;
  division: string | null;
  color?: string;
}

interface PlayerRow {
  id: string;
  name: string;
  team_id: string;
  number?: string | null;
}

interface GameRow {
  id: string;
  date: string;
  time: string;
  field: string | null;
  home_team_id: string;
  away_team_id: string;
}

interface RsvpRow {
  player_id: string;
  game_id: string;
  status: "yes" | "no" | "maybe";
}

async function loadData(tenantId: string): Promise<{
  teams: TeamRow[];
  players: PlayerRow[];
  games: GameRow[];
  rsvps: RsvpRow[];
}> {
  const db = getAdminDb();
  const [teamsSnap, playersSnap, gamesSnap, rsvpSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/teams`).get(),
    db.collection(`leagues/${tenantId}/players`).get(),
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/availability`).get(),
  ]);

  const teams: TeamRow[] = teamsSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: String(data.name ?? d.id),
      division: data.division ? String(data.division) : null,
      color: data.color ? String(data.color) : undefined,
    };
  });

  // Sort: division first (Saturday then Boomers), then alpha by name.
  const divisionRank = (d: string | null) =>
    d === "Saturday Division" ? 0 : d === "Boomers 60/70" ? 1 : 2;
  teams.sort((a, b) => {
    const dr = divisionRank(a.division) - divisionRank(b.division);
    if (dr !== 0) return dr;
    return a.name.localeCompare(b.name);
  });

  const players: PlayerRow[] = playersSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: String(data.name ?? ""),
        team_id: String(data.team_id ?? ""),
        number: data.number ? String(data.number) : null,
      };
    })
    .filter((p) => !!p.name);

  const today = new Date().toISOString().slice(0, 10);
  const games: GameRow[] = gamesSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        date: String(data.date ?? ""),
        time: String(data.time ?? ""),
        field: data.field ? String(data.field) : null,
        home_team_id: String(data.home_team_id ?? ""),
        away_team_id: String(data.away_team_id ?? ""),
        status: String(data.status ?? ""),
      };
    })
    // Upcoming = scheduled + dated >= today. (Use string compare —
    // both are YYYY-MM-DD, lexicographic order works.)
    .filter((g) => g.date >= today)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.time.localeCompare(b.time);
    });

  const rsvps: RsvpRow[] = rsvpSnap.docs
    .map((d) => d.data())
    .filter(
      (r) =>
        typeof r.player_id === "string" &&
        typeof r.game_id === "string" &&
        (r.status === "yes" || r.status === "no" || r.status === "maybe"),
    )
    .map((r) => ({
      player_id: String(r.player_id),
      game_id: String(r.game_id),
      status: r.status as "yes" | "no" | "maybe",
    }));

  return { teams, players, games, rsvps };
}

export default async function AvailabilityPage() {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) {
    return (
      <main className="container py-12">
        <p>Visit a tenant subdomain.</p>
      </main>
    );
  }

  const { teams, players, games, rsvps } = await loadData(tenantId);

  return (
    <main className="container py-10">
      <header className="mb-8">
        <p className="sec-eyebrow" style={{ color: "var(--brand-primary)" }}>
          Players
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
          Availability
        </h1>
        <p style={{ marginTop: 8, color: "var(--muted)", maxWidth: 680 }}>
          Pick your team, find your name, then mark Yes / Maybe / No
          for each upcoming game. No sign-in needed — your captain
          uses this to plan the lineup.
        </p>
      </header>

      {games.length === 0 ? (
        <div
          style={{
            padding: "32px 24px",
            background: "rgba(0,0,0,0.03)",
            border: "1px dashed rgba(0,0,0,0.12)",
            borderRadius: 12,
            textAlign: "center",
            color: "var(--muted)",
            maxWidth: 600,
          }}
        >
          <strong style={{ color: "var(--brand-primary)" }}>
            No upcoming games yet
          </strong>
          <p style={{ margin: "8px 0 0", fontSize: 14 }}>
            Once the league posts the next round of games, they&rsquo;ll
            appear here for you to RSVP.
          </p>
        </div>
      ) : (
        <AvailabilityPicker
          teams={teams}
          players={players}
          games={games}
          initialRsvps={rsvps}
        />
      )}
    </main>
  );
}

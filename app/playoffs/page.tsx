// Public playoff bracket page. Renders the classic tournament tree the
// admin builds at /admin → Playoffs. Auto-hides when bracket.active is
// false (regular season — nothing to show). Game date/field/time come
// from the linked scheduled game (match.game_id), and each matchup
// links to that game's preview/recap page.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { loadGamesAndTeamsSnaps } from "@/lib/league-cache";
import { formatGameDate, formatTime12 } from "@/lib/format-time";
import {
  PlayoffsBracket,
  type BracketDivision,
  type BracketGameInfo,
} from "@/components/ui/PlayoffsBracket";
import "./playoffs.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Playoffs",
  description: "Playoff bracket and results.",
};

interface Bracket {
  active: boolean;
  title: string;
  divisions: BracketDivision[];
}

// "Sun 7/19" + "9:30 AM" for a game's date/time (handles both the
// separate-time shape and combined-ISO UTC, rendered in league time).
function gameMeta(
  date: string,
  time: string,
  field: string | null,
): BracketGameInfo {
  const dateLabel = formatGameDate(date || null, time || null, {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
  let timeLabel = "";
  if (time && /^\d{1,2}:\d{2}/.test(time)) {
    timeLabel = formatTime12(time);
  } else if (/T\d{2}:\d{2}/.test(date)) {
    const d = new Date(date);
    if (!Number.isNaN(d.getTime())) {
      timeLabel = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
      }).format(d);
    }
  }
  return { dateLabel, timeLabel, field: field || null };
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
  const [bracketSnap, { gamesSnap, teamsSnap }] = await Promise.all([
    db.doc(`leagues/${tenantId}/site_config/playoffs`).get(),
    loadGamesAndTeamsSnaps(db, tenantId),
  ]);

  const bracket: Bracket | null = bracketSnap.exists
    ? {
        active: bracketSnap.data()?.active === true,
        title: String(bracketSnap.data()?.title ?? "Playoffs"),
        divisions: (bracketSnap.data()?.divisions ?? []) as BracketDivision[],
      }
    : null;

  if (!bracket || !bracket.active) {
    return (
      <main className="po-shell">
        <header className="po-header">
          <h1 className="po-title">Playoffs</h1>
        </header>
        <p className="po-empty">
          Playoff bracket isn&apos;t published yet. Check back later in the
          season.
        </p>
      </main>
    );
  }

  const teamName: Record<string, string> = {};
  for (const d of teamsSnap.docs) {
    teamName[d.id] = String(d.data().name ?? d.id);
  }

  const gameInfo: Record<string, BracketGameInfo> = {};
  for (const d of gamesSnap.docs) {
    const data = d.data();
    gameInfo[d.id] = gameMeta(
      data.date ? String(data.date) : "",
      data.time ? String(data.time) : "",
      data.field ? String(data.field) : null,
    );
  }

  return (
    <main className="po-shell">
      <header className="po-header">
        <h1 className="po-title">{bracket.title}</h1>
      </header>

      {bracket.divisions.length === 0 ? (
        <p className="po-empty">No divisions configured yet.</p>
      ) : (
        <PlayoffsBracket
          divisions={bracket.divisions}
          teamName={teamName}
          gameInfo={gameInfo}
        />
      )}
    </main>
  );
}

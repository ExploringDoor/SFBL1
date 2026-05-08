"use client";

// Homepage live-games strip. Subscribes to the games collection
// filtered by status=="live" and renders a row per active game.
// Disappears when no games are live.
//
// Why client-side with onSnapshot: this is the one place where
// real-time matters most. A fan refreshing the homepage to track
// the score expects updates within a second of the scorekeeper's
// tap, not a 60s revalidate window.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import "./HomepageLiveGames.css";

interface LiveGame {
  id: string;
  away_team_id: string;
  home_team_id: string;
  away_score: number;
  home_score: number;
  current_inning: number;
  current_half: "top" | "bottom";
}

interface Props {
  leagueId: string;
  /** Map of team_id → { name, abbrev } passed from the server-rendered
   *  homepage so we don't have to re-fetch on the client. */
  teamLabels: Record<string, { name: string; abbrev?: string }>;
}

export function HomepageLiveGames({ leagueId, teamLabels }: Props) {
  const [games, setGames] = useState<LiveGame[] | null>(null);

  useEffect(() => {
    const db = getDb();
    const q = query(
      collection(db, `leagues/${leagueId}/games`),
      where("status", "==", "live"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setGames(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              away_team_id: String(data.away_team_id ?? ""),
              home_team_id: String(data.home_team_id ?? ""),
              away_score: Number(data.away_score) || 0,
              home_score: Number(data.home_score) || 0,
              current_inning: Number(data.current_inning) || 1,
              current_half:
                data.current_half === "bottom" ? "bottom" : "top",
            };
          }),
        );
      },
      () => setGames([]),
    );
    return () => unsub();
  }, [leagueId]);

  // Render nothing during the initial fetch (avoids a brief flash).
  if (games === null) return null;
  if (games.length === 0) return null;

  return (
    <section className="hlg" aria-label="Live games">
      <div className="hlg-inner">
        <div className="hlg-label">
          <span className="hlg-dot" aria-hidden />
          <span>LIVE NOW</span>
        </div>
        <div className="hlg-rail">
          {games.map((g) => {
            const away =
              teamLabels[g.away_team_id]?.abbrev ??
              teamLabels[g.away_team_id]?.name ??
              g.away_team_id;
            const home =
              teamLabels[g.home_team_id]?.abbrev ??
              teamLabels[g.home_team_id]?.name ??
              g.home_team_id;
            return (
              <Link
                key={g.id}
                href={`/games/${g.id}`}
                className="hlg-card"
              >
                <span className="hlg-team">
                  <span className="hlg-team-name">{away}</span>
                  <span className="hlg-team-num">{g.away_score}</span>
                </span>
                <span className="hlg-team">
                  <span className="hlg-team-name">{home}</span>
                  <span className="hlg-team-num">{g.home_score}</span>
                </span>
                <span className="hlg-inning">
                  {g.current_half === "top" ? "TOP" : "BOT"}{" "}
                  {g.current_inning}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

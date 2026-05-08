"use client";

// Live score banner — renders on /games/[id] above the box score
// when the game's status is "live". Subscribes to the game doc via
// Firestore onSnapshot so updates from the scorekeeper at the field
// (POST /api/live-score) flow through within ~1 second of the tap.
//
// Once status flips to "final", the banner re-renders as a "FINAL"
// chip and stops live-pulsing — same visual real estate, no flicker.

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import "./LiveScoreBanner.css";

interface Props {
  leagueId: string;
  gameId: string;
  awayName: string;
  homeName: string;
  /** Initial score from the server-rendered page, used until the
   *  client-side subscription kicks in (≈30ms). Avoids a 0-0 flash. */
  initialAwayScore: number;
  initialHomeScore: number;
  initialStatus: string;
}

export function LiveScoreBanner({
  leagueId,
  gameId,
  awayName,
  homeName,
  initialAwayScore,
  initialHomeScore,
  initialStatus,
}: Props) {
  const [state, setState] = useState({
    away: initialAwayScore,
    home: initialHomeScore,
    inning: 1,
    half: "top" as "top" | "bottom",
    status: initialStatus,
  });

  useEffect(() => {
    const db = getDb();
    const ref = doc(db, `leagues/${leagueId}/games/${gameId}`);
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setState({
        away: Number(data.away_score) || 0,
        home: Number(data.home_score) || 0,
        inning: Number(data.current_inning) || 1,
        half:
          data.current_half === "bottom" ? "bottom" : "top",
        status: String(data.status ?? "scheduled"),
      });
    });
    return () => unsub();
  }, [leagueId, gameId]);

  const isLive = state.status === "live";
  const isFinal =
    state.status === "final" || state.status === "approved";
  if (!isLive && !isFinal) return null;

  return (
    <aside
      className={`lsb ${isLive ? "lsb-live" : "lsb-final"}`}
      // Live-region: screen readers announce score changes when the
      // doc updates. `polite` over `assertive` so we don't interrupt
      // mid-paragraph. `atomic` so the full score reads as a unit
      // ("Marlins 4 Yankees 2 top of 5") not just the changed digit.
      aria-live={isLive ? "polite" : "off"}
      aria-atomic="true"
    >
      <header className="lsb-status">
        {isLive ? (
          <>
            <span className="lsb-dot" aria-hidden />
            <span>LIVE</span>
            <span className="lsb-inning">
              {state.half === "top" ? "TOP" : "BOT"} {state.inning}
            </span>
          </>
        ) : (
          <span>FINAL</span>
        )}
      </header>
      <div className="lsb-score">
        <div className="lsb-team">
          <span className="lsb-team-name">{awayName}</span>
          <span className="lsb-team-num">{state.away}</span>
        </div>
        <div className="lsb-team">
          <span className="lsb-team-name">{homeName}</span>
          <span className="lsb-team-num">{state.home}</span>
        </div>
      </div>
      {/* Screen-reader-only summary that updates atomically. Two
          stacked columns read awkwardly to a screen reader; this
          sentence reads naturally. Visually hidden via .sr-only
          which is also defined globally. */}
      <span className="sr-only">
        {awayName} {state.away}, {homeName} {state.home}
        {isLive
          ? `, ${state.half === "top" ? "top" : "bottom"} of ${state.inning}`
          : ", final"}
      </span>
    </aside>
  );
}

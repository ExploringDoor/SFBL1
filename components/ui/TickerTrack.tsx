"use client";

// Client wrapper for the ticker's scrolling track. For age-grouped
// tenants (COYBL) it adds a compact age-group dropdown that filters the
// visible games (Adam asked for a dropdown, not pills). Flat leagues
// (SFBL/LBDC) carry no ageGroup, so the dropdown is hidden and the track
// renders exactly as before. The tile markup + helpers live here so the
// filter and the rendering stay together.

import { useMemo, useState } from "react";
import Link from "next/link";
import { parseGameDate } from "@/lib/format-time";
import type { TickerGame } from "./Ticker";

export function TickerTrack({ games }: { games: TickerGame[] }) {
  // Age groups present in the loaded games, ordered numerically
  // (7U, 8U, …, 14U — not "10U" before "7U" as a string sort would).
  const ages = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) if (g.ageGroup) set.add(g.ageGroup);
    return [...set].sort(
      (a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0),
    );
  }, [games]);
  const [age, setAge] = useState<string>("all");
  const shown =
    age === "all" ? games : games.filter((g) => g.ageGroup === age);

  return (
    <>
      {ages.length > 1 && (
        <select
          className="st-age-select"
          value={age}
          onChange={(e) => setAge(e.target.value)}
          aria-label="Filter scores by age group"
        >
          <option value="all">All ages</option>
          {ages.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      )}
      <div className="st-scroll">
        <div className="st-track">
          {shown.length > 0 ? (
            shown.map((g) => <TickerTile key={g.id} g={g} />)
          ) : (
            <div className="st-empty">
              No {age === "all" ? "" : age + " "}games yet
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function TickerTile({ g }: { g: TickerGame }) {
  const done = isDone(g);
  const aWin = done && (g.away_score ?? 0) > (g.home_score ?? 0);
  const hWin = done && (g.home_score ?? 0) > (g.away_score ?? 0);

  // Prefer the full team name everywhere — there's enough horizontal
  // room in the ticker tile and it reads cleaner than 2–3-letter
  // abbrevs which feel like league shorthand the user has to decode.
  // Falls back to abbrev or computed initials only if no name.
  const awayLabel =
    g.away_team.name ||
    g.away_team.abbrev ||
    fallbackAbbrev(g.away_team_id, g.away_team.name);
  const homeLabel =
    g.home_team.name ||
    g.home_team.abbrev ||
    fallbackAbbrev(g.home_team_id, g.home_team.name);

  return (
    <Link href={`/games/${g.id}`} className="st-game">
      <div className="st-game-inner">
        <div className={"st-datetime" + (done ? " final" : "")}>
          {statusLabel(g, done)}
        </div>

        <span
          className={
            "st-abbr" + (aWin ? " winner" : done ? " loser" : " upcoming")
          }
        >
          {awayLabel}
        </span>
        <span className="st-rec">
          {g.away_record ? `(${g.away_record})` : ""}
        </span>
        <span
          className={
            "st-score" + (done ? (aWin ? " winner" : " loser") : "")
          }
        >
          {done ? g.away_score : ""}
        </span>

        <span
          className={
            "st-abbr" + (hWin ? " winner" : done ? " loser" : " upcoming")
          }
        >
          {homeLabel}
        </span>
        <span className="st-rec">
          {g.home_record ? `(${g.home_record})` : ""}
        </span>
        <span
          className={
            "st-score" + (done ? (hWin ? " winner" : " loser") : "")
          }
        >
          {done ? g.home_score : ""}
        </span>
      </div>
    </Link>
  );
}

function isDone(g: TickerGame): boolean {
  return (
    (g.status === "final" || g.status === "approved") &&
    g.away_score !== null &&
    g.home_score !== null
  );
}

function statusLabel(g: TickerGame, done: boolean): string {
  if (g.status === "postponed") return "PPD";
  if (done) return "FINAL";
  if (g.status === "live") return "🔴 LIVE";
  if (!g.date) return "TBD";
  const d = parseGameDate(g.date);
  if (!d) return "TBD";
  const day = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
  if (!g.date.includes("T")) return day;
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

function fallbackAbbrev(id: string, name: string): string {
  // Prefer the team's name initials over the doc-id slug.
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const a = words[0]?.[0] ?? "";
    const b = words[1]?.[0] ?? "";
    const c = words[2]?.[0] ?? "";
    return (a + b + c).toUpperCase();
  }
  return (name.slice(0, 3) || id.slice(0, 3)).toUpperCase();
}

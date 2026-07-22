"use client";

// Client wrapper for the ticker's scrolling track. For age-grouped
// tenants (COYBL) it adds a compact age-group dropdown that filters the
// visible games (Adam asked for a dropdown, not pills). Flat leagues
// (SFBL/LBDC) carry no ageGroup, so the dropdown is hidden and the track
// renders exactly as before. The tile markup + helpers live here so the
// filter and the rendering stay together.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { parseGameDate } from "@/lib/format-time";
import type { TickerGame } from "./Ticker";

export function TickerTrack({
  games,
  scroll = false,
}: {
  games: TickerGame[];
  /** Marquee mode (flags.ticker_scroll). OFF for every existing tenant.
   *
   *  The default track deliberately does NOT animate — DVSL removed the
   *  marquee because users could not click a moving tile, and .st-scroll is
   *  overflow-x:auto so the user pans by hand. Those two are mutually
   *  exclusive: an animated translateX track cannot also be drag-panned.
   *
   *  Island Fastpitch asked for the LMLL-style scroll, so this mode swaps the
   *  manual pan for an animated loop AND pauses on hover, which is what makes
   *  the tiles clickable again and answers the original DVSL objection. */
  scroll?: boolean;
}) {
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

  // Only marquee when there is something to marquee.
  const marquee = scroll && shown.length > 0;

  // Pace the loop by width rather than a fixed duration, so a long list does
  // not fly past and a short one does not crawl. ~90px/sec matches LMLL.
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    if (!marquee) {
      el.style.animationDuration = "";
      return;
    }
    const pace = () => {
      const oneCopy = el.scrollWidth / 2;
      if (oneCopy > 0) {
        el.style.animationDuration = `${Math.max(12, Math.round(oneCopy / 90))}s`;
      }
    };
    pace();
    // Re-pace once webfonts land, since tile widths change with the real face.
    document.fonts?.ready.then(pace).catch(() => {});
    window.addEventListener("resize", pace);
    return () => window.removeEventListener("resize", pace);
  }, [marquee, shown.length, age]);

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
      <div className={"st-scroll" + (marquee ? " st-scroll--marquee" : "")}>
        <div
          ref={trackRef}
          className={"st-track" + (marquee ? " st-track--marquee" : "")}
        >
          {shown.length > 0 ? (
            <>
              {shown.map((g) => (
                <TickerTile key={g.id} g={g} />
              ))}
              {/* Second copy so translateX(-50%) lands exactly back at the
                  start and the loop has no visible seam. Hidden from
                  assistive tech so scores are not announced twice. */}
              {marquee && (
                <div className="st-track-clone" aria-hidden>
                  {shown.map((g) => (
                    <TickerTile key={`clone-${g.id}`} g={g} />
                  ))}
                </div>
              )}
            </>
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
          {/* CSS dot rather than a red-circle emoji: emoji render
              inconsistently across platforms and the house style keeps
              emoji out of the UI. */}
          {g.status === "live" && !done && (
            <span className="st-live-dot" aria-hidden />
          )}
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
  if (g.status === "live") return "LIVE";
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

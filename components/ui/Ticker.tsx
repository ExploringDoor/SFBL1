// Top score ticker — verbatim port of DVSL's #score-ticker
// (~/Desktop/softball-site/index.html lines 2902–2908 + buildTicker2
// at line 7264).
//
// Layout: navy band, full width, 48px tall (64px on mobile). Three
// regions side-by-side:
//   1. Left label cell — tenant short name + season year, links home.
//   2. Scrollable track of game tiles — one tile per game.
//   3. Right "Full Schedule »" cell — links to /scores.
//
// Each game tile has three rows stacked vertically:
//   - Status (FINAL, or "Sat 5/3 · 1:00 PM", or live badge)
//   - Away team:   ABBR (REC) score
//   - Home team:   ABBR (REC) score
//
// The track is NOT animated — DVSL killed the marquee scroll because
// users couldn't click moving tiles. Overflow horizontally if the
// game list is wide; the user pans manually.

import Link from "next/link";
import "./Ticker.css";

export interface TickerGame {
  id: string;
  /** ISO datetime string for game start, or null if TBD. */
  date: string | null;
  /** "scheduled" | "live" | "final" | "approved" | "postponed" */
  status: string;
  away_team_id: string;
  home_team_id: string;
  away_score: number | null;
  home_score: number | null;
  away_team: { name: string; abbrev?: string };
  home_team: { name: string; abbrev?: string };
  /** "5-2" / "8-3-1" — formatted by the data layer. */
  away_record?: string;
  home_record?: string;
}

export interface TickerProps {
  /** Games to render, ordered however the data layer chose (typically
   *  most-recent finals first then upcoming). */
  games: TickerGame[];
  /** Tenant short name shown in the left label when no logo is set. */
  tenantShort: string;
  /** Season year shown next to the short name (text mode only). */
  seasonYear: number;
  /** Tenant league banner. When provided, replaces the hex+short+year
   *  text in the left label. Most leagues set this to their full
   *  graphical wordmark (e.g. SFBL's "South Florida BASEBALL LEAGUE"
   *  art) so the ticker double-serves as the site's visual header. */
  logoUrl?: string | null;
  /** Where the left label and right "Full Schedule" link point. */
  homeHref?: string;
  scoresHref?: string;
}

export function Ticker({
  games,
  tenantShort,
  seasonYear,
  logoUrl,
  homeHref = "/",
  scoresHref = "/scores",
}: TickerProps) {
  return (
    <div id="score-ticker">
      <Link
        href={homeHref}
        className={"st-label" + (logoUrl ? " has-logo" : "")}
        title="Home"
        aria-label={tenantShort}
      >
        {logoUrl ? (
          /* Audit M9: above-the-fold ticker logo. width/height stops
             layout shift once the image lands; loading="eager" +
             decoding=async keep it in the critical path without
             blocking. Dimensions sized for the 48px ticker height
             with proportional width capped by max-width:56px in CSS. */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={logoUrl}
            alt={tenantShort}
            className="st-label-img"
            width={160}
            height={48}
            loading="eager"
            decoding="async"
          />
        ) : (
          <>
            <span aria-hidden>⬡</span>
            <span>{tenantShort}</span>
            <span className="st-label-year">{seasonYear}</span>
          </>
        )}
      </Link>

      <div className="st-scroll">
        <div className="st-track">
          {games.map((g) => (
            <TickerTile key={g.id} g={g} />
          ))}
        </div>
      </div>

      <Link href={scoresHref} className="st-full">
        Full Schedule »
      </Link>
    </div>
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

  // 3-column grid: abbrev | record | score. Each tile renders the
  // datetime row spanning all 3 columns, then 6 cells (3 per team)
  // as direct grid children. Empty strings render as zero-width
  // cells that still hold the column position so scores stay
  // vertically aligned regardless of record presence.
  return (
    <Link href={`/games/${g.id}`} className="st-game">
      <div className="st-game-inner">
        <div className="st-datetime">{statusLabel(g, done)}</div>

        <span
          className={
            "st-abbr" +
            (aWin ? " winner" : done ? " loser" : " upcoming")
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
            "st-abbr" +
            (hWin ? " winner" : done ? " loser" : " upcoming")
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
  const d = new Date(g.date);
  const day = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
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

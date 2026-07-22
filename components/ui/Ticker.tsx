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
// The track is NOT animated by default — DVSL killed the marquee scroll
// because users couldn't click moving tiles. Overflow horizontally if the
// game list is wide; the user pans manually.
//
// Tenants that set flags.ticker_scroll (Island Fastpitch) opt back into a
// marquee that pauses on hover and focus, which keeps tiles clickable and
// so answers the original DVSL objection.

import Link from "next/link";
import { TickerTrack } from "./TickerTrack";
import "./Ticker.css";

export interface TickerGame {
  id: string;
  /**
   * Game start as produced by site-data's combineDateTime (audit
   * L11): a combined local ISO ("2026-05-16T19:00:00") when a start
   * time exists, OR a bare "YYYY-MM-DD" when the time is TBD, OR null
   * if there's no date. statusLabel() handles all three via
   * parseGameDate and only renders a clock when a "T" is present —
   * so a date-only value shows the day with no bogus "12:00 AM".
   */
  date: string | null;
  /** "scheduled" | "live" | "final" | "approved" | "postponed" */
  status: string;
  away_team_id: string;
  home_team_id: string;
  away_score: number | null;
  home_score: number | null;
  away_team: {
    name: string;
    abbrev?: string;
    logoUrl?: string | null;
  };
  home_team: {
    name: string;
    abbrev?: string;
    logoUrl?: string | null;
  };
  /** "5-2" / "8-3-1" — formatted by the data layer. */
  away_record?: string;
  home_record?: string;
  /** Age group ("9U") for age-grouped tenants (COYBL). Drives the
   *  ticker's age-filter dropdown; undefined for flat leagues. */
  ageGroup?: string;
}

export interface TickerProps {
  /** Games to render, ordered however the data layer chose (typically
   *  most-recent finals first then upcoming). */
  games: TickerGame[];
  /** Tenant short name shown in the left label when no logo is set. */
  tenantShort: string;
  /** Season year shown next to the short name (text mode only). */
  seasonYear: number;
  /** Small mark before the short name in text mode. Defaults to the
   *  generic hexagon; sport-specific leagues override it (e.g. COYBL
   *  uses a baseball). */
  mark?: string;
  /** Tenant league banner. When provided, replaces the hex+short+year
   *  text in the left label. Most leagues set this to their full
   *  graphical wordmark (e.g. SFBL's "South Florida BASEBALL LEAGUE"
   *  art) so the ticker double-serves as the site's visual header. */
  logoUrl?: string | null;
  /** Where the left label and right "Full Schedule" link point. */
  homeHref?: string;
  scoresHref?: string;
  /** Marquee mode (flags.ticker_scroll). OFF for every existing tenant —
   *  see TickerTrack for why panning and scrolling are mutually exclusive. */
  scroll?: boolean;
  /** Hide the left label cell entirely so the scrolling scores fill
   *  the full width. SFBL uses this — its wordmark was too big in the
   *  top-left on mobile/the installed app, and the homepage Hero +
   *  nav brand already carry the branding. (Adam, 2026-05-18.) */
  hideLabel?: boolean;
}

export function Ticker({
  games,
  tenantShort,
  seasonYear,
  mark = "⬡",
  logoUrl,
  homeHref = "/",
  scoresHref = "/scores",
  hideLabel = false,
  scroll = false,
}: TickerProps) {
  return (
    <div id="score-ticker">
      {!hideLabel && (
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
               blocking. Sizing is height-driven in CSS (.st-label-img
               height:110px desktop / 120px mobile, width:auto) — there
               is no width cap. */
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
              <span aria-hidden>{mark}</span>
              <span>{tenantShort}</span>
              <span className="st-label-year">{seasonYear}</span>
            </>
          )}
        </Link>
      )}

      <TickerTrack games={games} scroll={scroll} />

      <Link href={scoresHref} className="st-full">
        Full Schedule »
      </Link>
    </div>
  );
}

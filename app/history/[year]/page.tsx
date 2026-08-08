// /history/[year] — one season's playoffs: every division's bracket, filled
// out with the real teams and scores, plus the champion photo.
//
// Reads data/{tenantId}/playoffs/{year}.json, built by the tenant's own
// extraction pipeline. Absent file → 404, so tenants without a playoff archive
// are unaffected.
//
// Rendered with components/BracketTree — the SAME bracket renderer that runs on
// D27, STSBT and Texas Select, ported from js/sts-bracket-render.js. Cards are
// absolutely positioned on a canvas with SVG elbow connectors, winners bracket
// above losers, championship to the right.
//
// That renderer works from WG-n / LG-n advancement refs, which this archive does
// not print. lib/bracket-refs derives them from the results themselves: a team
// that won game 3 and then reappears IS the winner of game 3. Nothing is
// invented — a side that cannot be traced to an earlier result keeps its
// literal team name, which is correct for a team entering the bracket.

import * as fs from "node:fs";
import * as path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { BracketTree } from "@/components/BracketTree";
import { BracketControls } from "@/components/BracketControls";
import { deriveBracketRefs, type HistoricalGame } from "@/lib/bracket-refs";
import "../history.css";
import "./bracket.css";

export const dynamic = "force-dynamic";

interface Side {
  seed: string | null;
  name: string;
}
interface Entry {
  sideA: Side;
  sideB: Side;
  /** One row per game. A best-of-3 series carries three. */
  games: { a: number | null; b: number | null }[];
}
interface Round {
  label: string;
  entries: Entry[];
}
interface Photo {
  url: string;
  caption: string | null;
  kind: string;
}
interface DivisionBracket {
  division: string;
  champion: string | null;
  runner_up: string | null;
  disputed: boolean;
  rounds: Round[];
  photos: Partial<Record<"champion" | "runner_up" | "combined", Photo>>;
}
interface YearPayload {
  year: number;
  divisions: DivisionBracket[];
}

function loadYear(tenantId: string, year: string): YearPayload | null {
  if (!/^\d{4}$/.test(year)) return null;
  const file = path.resolve(
    process.cwd(),
    `data/${tenantId}/playoffs/${year}.json`,
  );
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as YearPayload;
  } catch {
    return null;
  }
}

function loadIndex(tenantId: string): { year: number }[] {
  const file = path.resolve(process.cwd(), `data/${tenantId}/playoffs/index.json`);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as { year: number }[];
  } catch {
    return [];
  }
}

export default async function PlayoffYearPage({
  params,
}: {
  params: { year: string };
}) {
  const h = headers();
  const tenantId = h.get("x-tenant-id") ?? "";
  const cfgRaw = h.get("x-tenant-config");
  const cfg = cfgRaw
    ? (JSON.parse(cfgRaw) as PublicLeagueConfig)
    : null;
  const leagueName = cfg?.name ?? "League";

  const data = loadYear(tenantId, params.year);
  if (!data) notFound();

  const years = loadIndex(tenantId).map((r) => r.year);
  const idx = years.indexOf(data.year);
  const prev = idx >= 0 ? years[idx + 1] : undefined; // index is newest-first
  const next = idx > 0 ? years[idx - 1] : undefined;

  const withGames = data.divisions.filter((d) => d.rounds.length > 0);
  const withoutGames = data.divisions.filter((d) => d.rounds.length === 0);

  // Branded trophy on each division's champion banner, when the tenant ships one.
  const trophyUrl = fs.existsSync(
    path.resolve(process.cwd(), `public/${tenantId}/trophy.png`),
  )
    ? `/${tenantId}/trophy.png`
    : undefined;

  // Precomputed normalized-team-name -> logo map so every bracket side carries
  // its club logo (initials fallback in the renderer where a name can't resolve).
  const teamLogos: Record<string, string> = (() => {
    const f = path.resolve(process.cwd(), `data/${tenantId}/bracket-logos.json`);
    if (!fs.existsSync(f)) return {};
    try {
      return JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  })();

  return (
    /* `container py-10` matches the main history page — without it the page
       sits flush against the viewport edge. */
    <main className="container py-10 le-bracket-page">
      <header className="le-history-hd">
        <p className="le-history-eyebrow">
          <Link href="/history">Archive</Link> · Playoffs
        </p>
        <h1 className="le-history-title">{data.year} Playoffs</h1>
        <p className="le-history-sub">
          Every {leagueName} division bracket recorded for {data.year}.
        </p>
        <nav className="le-yr-nav" aria-label="Season">
          {prev ? (
            <Link href={`/history/${prev}`} className="le-yr-btn">
              ‹ {prev}
            </Link>
          ) : (
            <span className="le-yr-btn le-yr-btn-off">‹</span>
          )}
          <Link href="/history" className="le-yr-btn">
            All seasons
          </Link>
          {next ? (
            <Link href={`/history/${next}`} className="le-yr-btn">
              {next} ›
            </Link>
          ) : (
            <span className="le-yr-btn le-yr-btn-off">›</span>
          )}
        </nav>
      </header>

      {withGames.length === 0 && (
        <p className="le-bk-empty">
          The {data.year} archive records champions but no individual bracket
          games. Those pages were printed as a champion banner only.
        </p>
      )}

      {withGames.length > 0 && (
        <BracketControls
          sections={withGames.map((d) => ({
            id: divisionAnchor(d.division),
            label: shortDivision(d.division),
          }))}
        >
          {withGames.map((d) => (
            <DivisionSection
              key={d.division}
              d={d}
              trophyUrl={trophyUrl}
              teamLogos={teamLogos}
            />
          ))}
        </BracketControls>
      )}

      {withoutGames.length > 0 && (
        <section className="le-hist-card">
          <header className="le-hist-card-hd">
            <h2>Champions with no bracket recorded</h2>
          </header>
          <ul className="le-bk-nolist">
            {withoutGames.map((d) => (
              <li key={d.division}>
                <strong>{d.division || "—"}</strong>
                <span>
                  {d.champion ?? "—"}
                  {d.runner_up ? ` · def. ${d.runner_up}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/** Stable anchor for a division, e.g. "10u Section 1" -> "d-10u-section-1". */
function divisionAnchor(division: string): string {
  return (
    "d-" +
    (division || "division")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

/** Compact label for the jump buttons: "10u Section 1" -> "10u Sec 1". The
 *  full name still heads the section itself. */
function shortDivision(division: string): string {
  return (division || "Division").replace(/\bSection\b/i, "Sec");
}

function DivisionSection({
  d,
  trophyUrl,
  teamLogos,
}: {
  d: DivisionBracket;
  trophyUrl?: string;
  teamLogos?: Record<string, string>;
}) {
  const photo = d.photos.champion ?? d.photos.combined ?? null;

  // The archive stores printed rounds with concrete team names; the ported
  // renderer needs WG-n / LG-n advancement refs, so convert here.
  const flat: HistoricalGame[] = d.rounds.flatMap((r) =>
    r.entries.flatMap((e) =>
      e.games.map((gm) => ({
        round: r.label,
        sideA: [e.sideA.seed ? `#${e.sideA.seed}` : "", e.sideA.name]
          .filter(Boolean)
          .join(" "),
        sideB: [e.sideB.seed ? `#${e.sideB.seed}` : "", e.sideB.name]
          .filter(Boolean)
          .join(" "),
        scoreA: gm.a,
        scoreB: gm.b,
      })),
    ),
  );
  const bracket = deriveBracketRefs(flat);

  return (
    <section className="le-bk-div" id={divisionAnchor(d.division)}>
      <header className="le-bk-div-hd">
        <h2>{d.division || "Division"}</h2>
        {d.runner_up && (
          <p className="le-bk-runner">
            Runner-up: <strong>{d.runner_up}</strong>
            {d.disputed && (
              <span
                className="le-champ-disputed"
                title="The league's own records disagree on this title — awaiting confirmation."
              >
                unconfirmed
              </span>
            )}
          </p>
        )}
      </header>

      <BracketTree
        games={bracket}
        tournamentName={d.division}
        championPhoto={photo ? { url: photo.url, caption: photo.caption } : null}
        trophyUrl={trophyUrl}
        teamLogos={teamLogos}
      />
    </section>
  );
}

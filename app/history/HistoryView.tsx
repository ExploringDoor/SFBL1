"use client";

// Interactive history view. Tabs across the top; each tab is a
// self-contained React subtree. State lives entirely on the client —
// no round-trips to the server when switching tabs or filtering.
//
// Tabs:
//   1. Champions  — wall of trophies + all-time count leaderboard.
//   2. Records    — all-time wins, oldest team, biggest dynasties.
//   3. Standings  — original picker view, but inline-rendered.
//
// Why client-side instead of `?tab=` query-string:
//   The user explicitly asked for a more interactive page. Tabs that
//   reload the page feel sluggish; instant tab switches + filter
//   typing + animated row transitions all need state. We still get
//   crawlable URLs because the History link goes to /history (the
//   default Champions tab is what gets indexed, which is fine).

import Link from "next/link";
import { ChampionsSlideshow } from "@/components/ChampionsSlideshow";
import { useMemo, useState } from "react";
import type {
  ArchivedGame,
  ChampionRow,
  HistoryViewProps,
  LeaderboardRow,
  StandingRow,
  StandingsBlock,
  TeamMeta,
} from "./types";

type TabId = "champions" | "records" | "standings" | "scores";

export function HistoryView(props: HistoryViewProps) {
  const [tab, setTab] = useState<TabId>("champions");
  // Leagues without a recorded playoff bracket crown division winners, not
  // champions. Wording only; the data and layout are identical.
  const divWinners = props.honourLabel === "division-winner";
  const honourPlural = divWinners ? "Division Winners" : "Champions";
  const archive = props.archivedGames ?? [];
  const hasArchive = archive.some((a) => a.games.length > 0);
  // Seasons with a full bracket page. Built once so every season label can do
  // an O(1) lookup instead of scanning an array per row.
  const bracketYearSet = useMemo(
    () => new Set(props.bracketYears ?? []),
    [props.bracketYears],
  );

  return (
    <>
      <StatsStrip stats={props.stats} divWinners={divWinners} />

      <nav className="le-hist-tabs" role="tablist" aria-label="History sections">
        <TabButton id="champions" current={tab} onSelect={setTab}>
          🏆 {honourPlural}
        </TabButton>
        <TabButton id="records" current={tab} onSelect={setTab}>
          📊 Records
        </TabButton>
        <TabButton id="standings" current={tab} onSelect={setTab}>
          📋 Standings
        </TabButton>
        {hasArchive && (
          <TabButton id="scores" current={tab} onSelect={setTab}>
            ⚾ Scores
          </TabButton>
        )}
      </nav>

      <div className="le-hist-panel" role="tabpanel">
        {tab === "champions" && props.trophyUrl && (
          <div className="le-champ-hero">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={props.trophyUrl} alt="" className="le-champ-hero-trophy" />
            <div>
              <p className="le-champ-hero-eyebrow">Since 1954</p>
              <h2 className="le-champ-hero-title">
                {divWinners ? "Division Winners" : "Champions"}
              </h2>
              <p className="le-champ-hero-sub">
                Every title in {props.stats.seasonCount} seasons of Lancaster
                County youth baseball.
              </p>
            </div>
          </div>
        )}
        {tab === "champions" && (props.championSlides?.length ?? 0) > 0 && (
          <ChampionsSlideshow slides={props.championSlides!} />
        )}
        {tab === "champions" && (
          <ChampionsTab
            champions={props.champions}
            leaderboard={props.championsLb}
            divWinners={divWinners}
            bracketYears={bracketYearSet}
            trophyUrl={props.trophyUrl}
          />
        )}
        {tab === "scores" && hasArchive && (
          <ArchivedScoresTab archive={archive} />
        )}
        {tab === "records" && (
          <RecordsTab winsLb={props.winsLb} all={props.all} />
        )}
        {tab === "standings" && (
          <StandingsTab all={props.all} nameIdx={props.nameIdx} />
        )}
      </div>
    </>
  );
}

// ── Archived scores ────────────────────────────────────────────────
// Every game from a season that has been cleared off the live site, so the
// results stay browsable after the rollover. Filter by team, date or
// division; grouped by date so it reads like the schedule it replaced.

function ArchivedScoresTab({
  archive,
}: {
  archive: { season: string; games: ArchivedGame[] }[];
}) {
  const [season, setSeason] = useState(archive[0]?.season ?? "");
  const [filter, setFilter] = useState("");
  const active = archive.find((a) => a.season === season) ?? archive[0];
  const q = filter.trim().toLowerCase();

  const games = (active?.games ?? []).filter(
    (g) =>
      !q ||
      g.home.toLowerCase().includes(q) ||
      g.away.toLowerCase().includes(q) ||
      (g.division ?? "").toLowerCase().includes(q) ||
      (g.ageGroup ?? "").toLowerCase().includes(q) ||
      g.date.includes(q),
  );

  const byDate = new Map<string, ArchivedGame[]>();
  for (const g of games) {
    const arr = byDate.get(g.date) ?? [];
    arr.push(g);
    byDate.set(g.date, arr);
  }
  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

  return (
    <section className="le-hist-card le-hist-card-wide">
      <header className="le-hist-card-hd">
        <h2>
          <span aria-hidden="true">⚾</span> Scores
        </h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {archive.length > 1 && (
            <select
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              className="le-hist-search"
              aria-label="Season"
            >
              {archive.map((a) => (
                <option key={a.season} value={a.season}>
                  {a.season}
                </option>
              ))}
            </select>
          )}
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter team, division or date…"
            className="le-hist-search"
            aria-label="Filter scores"
          />
        </div>
      </header>

      <p className="le-arc-count">
        {games.length.toLocaleString()} game{games.length === 1 ? "" : "s"}
        {active ? ` from ${active.season}` : ""}
      </p>

      {dates.length === 0 ? (
        <p className="le-hist-empty">No games match that filter.</p>
      ) : (
        dates.map((d) => (
          <div key={d} className="le-arc-day">
            <h3 className="le-arc-date">{prettyDate(d)}</h3>
            <div className="le-dw-scroll">
              <table className="le-dw-table">
                <tbody>
                  {byDate.get(d)!.map((g, i) => {
                    const hw =
                      typeof g.home_score === "number" &&
                      typeof g.away_score === "number" &&
                      g.home_score > g.away_score;
                    const aw =
                      typeof g.home_score === "number" &&
                      typeof g.away_score === "number" &&
                      g.away_score > g.home_score;
                    return (
                      <tr key={i}>
                        <td className="le-dw-div">
                          {[g.ageGroup, g.division].filter(Boolean).join(" · ")}
                        </td>
                        <td className={aw ? "le-dw-team" : undefined}>
                          {g.away}
                        </td>
                        <td className="le-dw-rec">{g.away_score ?? ""}</td>
                        <td style={{ color: "var(--muted)", padding: "0 6px" }}>
                          {/* "at" names a home team. Archives that never
                              recorded which side was home get "vs" instead. */}
                          {g.orientation_known === false ? "vs" : "at"}
                        </td>
                        <td className={hw ? "le-dw-team" : undefined}>
                          {g.home}
                        </td>
                        <td className="le-dw-rec">{g.home_score ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

/** "2026-06-29" -> "Mon, Jun 29". Built from parts so the calendar day
 *  never shifts backwards in a western timezone. */
function prettyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ── Stats strip (always-visible KPIs) ──────────────────────────────

function StatsStrip({
  stats,
  divWinners,
}: {
  stats: HistoryViewProps["stats"];
  divWinners?: boolean;
}) {
  return (
    <div className="le-hist-stats">
      <Stat label="Seasons" value={String(stats.seasonCount)} />
      <Stat label="Since" value={stats.oldestYear} />
      <Stat
        label={divWinners ? "Division Titles" : "Champions"}
        value={String(stats.totalChampionships)}
      />
      <Stat label="Teams Ever" value={String(stats.teamCount)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="le-hist-stat">
      <div className="le-hist-stat-val">{value}</div>
      <div className="le-hist-stat-lbl">{label}</div>
    </div>
  );
}

// ── Tab button ────────────────────────────────────────────────────

function TabButton({
  id,
  current,
  onSelect,
  children,
}: {
  id: TabId;
  current: TabId;
  onSelect: (id: TabId) => void;
  children: React.ReactNode;
}) {
  const active = id === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={"le-hist-tab" + (active ? " active" : "")}
      onClick={() => onSelect(id)}
    >
      {children}
    </button>
  );
}

// ── Tab 1: Champions ───────────────────────────────────────────────

function ChampionsTab({
  champions,
  leaderboard,
  divWinners,
  bracketYears,
  trophyUrl,
}: {
  champions: ChampionRow[];
  leaderboard: LeaderboardRow[];
  divWinners?: boolean;
  bracketYears: Set<number>;
  trophyUrl?: string;
}) {
  const [filter, setFilter] = useState("");
  const filterLower = filter.trim().toLowerCase();

  const filteredChamps = useMemo(() => {
    if (!filterLower) return champions;
    return champions
      .map((row) => ({
        ...row,
        divisions: row.divisions.filter(
          (d) =>
            d.team.toLowerCase().includes(filterLower) ||
            d.division.toLowerCase().includes(filterLower) ||
            row.season.toLowerCase().includes(filterLower),
        ),
      }))
      .filter((r) => r.divisions.length > 0);
  }, [champions, filterLower]);

  return (
    <>
      <div className="le-hist-grid">
        <section className="le-hist-card le-hist-card-wide">
          <header className="le-hist-card-hd">
            <h2>
              {trophyUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={trophyUrl}
                  alt=""
                  className="le-champ-hd-trophy"
                  aria-hidden="true"
                />
              ) : (
                <span aria-hidden="true">🏆</span>
              )}{" "}
              {divWinners ? "Division Winners" : "Wall of Champions"}
            </h2>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter team or season…"
              className="le-hist-search"
              aria-label="Filter champions"
            />
          </header>

          {filteredChamps.length === 0 ? (
            <p className="le-hist-empty">
              No {divWinners ? "division winners" : "champions"} match "
              {filter}".
            </p>
          ) : (
            <ol className="le-champ-list">
              {filteredChamps.map((row) =>
                divWinners ? (
                  <DivisionWinnerSeason key={row.season} row={row} />
                ) : (
                  <ChampionRowView
                    key={row.season}
                    row={row}
                    bracketYears={bracketYears}
                  />
                ),
              )}
            </ol>
          )}
        </section>

        <section className="le-hist-card">
          <header className="le-hist-card-hd">
            <h2>{divWinners ? "Most Division Titles" : "Most Championships"}</h2>
          </header>
          <Leaderboard
            rows={leaderboard.slice(0, 12)}
            unitSingular="title"
            unitPlural="titles"
          />
        </section>
      </div>
    </>
  );
}

// A season of division winners. COYBL runs up to 22 divisions in a single
// season across 11 seasons, so the badge wall used for bracket champions
// turns into an unreadable pile. A table per season stays scannable: one
// row per division, aligned, sorted, with the winner's record.
function DivisionWinnerSeason({ row }: { row: ChampionRow }) {
  const rows = [...row.divisions].sort((a, b) =>
    a.division.localeCompare(b.division, undefined, { numeric: true }),
  );
  return (
    <li className="le-dw-season">
      <div className="le-dw-head">
        <h3 className="le-dw-year">{row.season}</h3>
        <span className="le-dw-count">
          {rows.length} division{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="le-dw-scroll">
        <table className="le-dw-table">
          <thead>
            <tr>
              <th scope="col">Division</th>
              <th scope="col">Winner</th>
              <th scope="col" className="le-dw-rec">
                Record
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.division + d.team}>
                <td className="le-dw-div">{tidyDivision(d.division)}</td>
                <td className="le-dw-team">{d.team}</td>
                <td className="le-dw-rec">{d.record ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </li>
  );
}

// "American Buckeye Division" reads better as "American Buckeye" once it is
// already sitting under a Division column header.
function tidyDivision(name: string): string {
  return name.replace(/\s+division$/i, "").trim() || name;
}

/** "2025" -> 2025. Season labels can carry a qualifier ("Spring - 2024"), so
 *  the year is extracted rather than parsed whole. */
function seasonYear(season: string): number {
  const m = /\d{4}/.exec(season);
  return m ? Number(m[0]) : NaN;
}

/** One season of champions, as a card.
 *
 *  The previous layout was a season label beside a wrapping run of pill
 *  badges. At eight divisions across seventeen seasons that reads as a heap of
 *  pills with no alignment — you cannot scan down a column to compare seasons,
 *  and the runner-up had nowhere to sit. A card with an aligned grid fixes
 *  both: division on the left, champion and the team it beat on the right,
 *  same columns every season. */
function ChampionRowView({
  row,
  bracketYears,
}: {
  row: ChampionRow;
  bracketYears: Set<number>;
}) {
  const year = seasonYear(row.season);
  const hasBracket = bracketYears.has(year);
  const divs = [...row.divisions].sort((a, b) =>
    a.division.localeCompare(b.division, undefined, { numeric: true }),
  );
  return (
    <li className="le-cs">
      <header className="le-cs-hd">
        <h3 className="le-cs-year">
          {hasBracket ? (
            <Link href={`/history/${year}`} className="le-cs-year-link">
              {row.season}
            </Link>
          ) : (
            row.season
          )}
        </h3>
        <span className="le-cs-count">
          {divs.length} champion{divs.length === 1 ? "" : "s"}
        </span>
        {hasBracket && (
          <Link href={`/history/${year}`} className="le-cs-cta">
            View brackets ›
          </Link>
        )}
      </header>

      <div className="le-cs-grid">
        {divs.map((d, i) => (
          <div className="le-cs-row" key={`${d.division}-${d.team}-${i}`}>
            <span className="le-cs-div">
              {tidyDivision(d.division) || "—"}
              {d.disputed && (
                <span
                  className="le-champ-disputed"
                  title="The league's own records disagree on this title — awaiting confirmation."
                >
                  unconfirmed
                </span>
              )}
            </span>
            <span className="le-cs-win">
              <ChampLogo team={d.team} meta={d.meta} />
              {d.meta ? (
                <Link href={`/teams/${d.meta.id}`} className="le-cs-team">
                  {d.team}
                </Link>
              ) : (
                <span className="le-cs-team">{d.team}</span>
              )}
            </span>
            <span className="le-cs-runner">
              {d.runnerUp ? <>def. {d.runnerUp}</> : ""}
            </span>
          </div>
        ))}
      </div>
    </li>
  );
}

/** Crest when the historical name matches a current club, monogram otherwise. */
function ChampLogo({ team, meta }: { team: string; meta: TeamMeta | null }) {
  if (meta?.logoUrl) {
    return <img src={meta.logoUrl} alt="" className="le-cs-logo" loading="lazy" />;
  }
  return (
    <span
      className="le-cs-logo le-cs-logo-fb"
      aria-hidden="true"
      style={{ background: meta?.color ?? "#7a5c00" }}
    >
      {initials(team)}
    </span>
  );
}

function ChampBadge({
  division,
  team,
  meta,
  runnerUp = null,
  disputed = false,
}: {
  division: string;
  team: string;
  meta: TeamMeta | null;
  /** Beaten finalist, where the league publishes one. */
  runnerUp?: string | null;
  /** The source contradicts itself about this title. Marked in the UI rather
   *  than resolved silently — a disputed championship shown as settled fact is
   *  the kind of error a league notices immediately. */
  disputed?: boolean;
}) {
  const accent = meta?.color ?? "#7a5c00"; // muted gold fallback
  const inner = (
    <>
      {meta?.logoUrl ? (
        <img
          src={meta.logoUrl}
          alt=""
          className="le-champ-logo"
          loading="lazy"
        />
      ) : (
        <span
          className="le-champ-logo le-champ-logo-fallback"
          aria-hidden="true"
          style={{ background: accent }}
        >
          {initials(team)}
        </span>
      )}
      <span className="le-champ-badge-text">
        <span className="le-champ-div">
          {division || "—"}
          {disputed && (
            <span
              className="le-champ-disputed"
              title="The league's own records disagree on this title — awaiting confirmation."
            >
              unconfirmed
            </span>
          )}
        </span>
        <span className="le-champ-team">{team}</span>
        {runnerUp && (
          <span className="le-champ-runner">
            def. <strong>{runnerUp}</strong>
          </span>
        )}
      </span>
    </>
  );
  if (meta) {
    return (
      <Link
        href={`/teams/${meta.id}`}
        className="le-champ-badge le-champ-badge-link"
        style={{ borderColor: accent + "55" }}
      >
        {inner}
      </Link>
    );
  }
  return (
    <span className="le-champ-badge" style={{ borderColor: accent + "55" }}>
      {inner}
    </span>
  );
}

// ── Tab 2: Records ─────────────────────────────────────────────────

function RecordsTab({
  winsLb,
  all,
}: {
  winsLb: LeaderboardRow[];
  all: StandingsBlock[];
}) {
  // Best regular-season record ever — sort all "season" blocks by
  // win-pct (with a min-games gate so a team that played 1 game and
  // won doesn't dominate). Computed in render, cheap relative to the
  // archive size (~250 blocks).
  const bestSeasons = useMemo(() => {
    const out: {
      team: string;
      season: string;
      division: string;
      w: number;
      l: number;
      pct: string;
    }[] = [];
    for (const b of all) {
      if (b.game_type !== "season") continue;
      for (const r of b.standings) {
        if (r.g < 8) continue; // min-games gate
        out.push({
          team: r.team,
          season: b.season,
          division: b.division,
          w: r.w,
          l: r.l,
          pct: r.pct,
        });
      }
    }
    out.sort(
      (a, b) =>
        parseFloat(b.pct) - parseFloat(a.pct) ||
        b.w - a.w ||
        a.team.localeCompare(b.team),
    );
    return out.slice(0, 10);
  }, [all]);

  return (
    <div className="le-hist-grid">
      <section className="le-hist-card">
        <header className="le-hist-card-hd">
          <h2>All-Time Wins</h2>
        </header>
        <Leaderboard rows={winsLb} unitSingular="win" unitPlural="wins" />
      </section>

      <section className="le-hist-card">
        <header className="le-hist-card-hd">
          <h2>Best Regular-Season Record</h2>
        </header>
        <p className="le-hist-card-sub">
          Min. 8 games. Top 10 across every recorded season.
        </p>
        <ol className="le-best-list">
          {bestSeasons.map((s, i) => (
            <li key={`${s.season}-${s.team}-${i}`} className="le-best-row">
              <span className="le-best-rank">{i + 1}</span>
              <span className="le-best-main">
                <span className="le-best-team">{s.team}</span>
                <span className="le-best-meta">
                  {s.season}
                  {s.division ? ` · ${s.division}` : ""}
                </span>
              </span>
              <span className="le-best-stat">
                <span className="le-best-pct">{s.pct}</span>
                <span className="le-best-wl">
                  {s.w}-{s.l}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

// ── Tab 3: Standings browser ──────────────────────────────────────

function StandingsTab({
  all,
  nameIdx,
}: {
  all: StandingsBlock[];
  nameIdx: Record<string, TeamMeta>;
}) {
  const seasons = useMemo(() => uniqueSeasons(all), [all]);
  const [season, setSeason] = useState<string>(seasons[0] ?? "");
  const [type, setType] = useState<"season" | "playoff">("season");

  const divisions = useMemo(() => {
    const set = new Set<string>();
    for (const b of all) {
      if (b.season === season && b.game_type === type) set.add(b.division);
    }
    return [...set].sort(divisionSort);
  }, [all, season, type]);

  const [division, setDivision] = useState<string>("");

  // Reset division when season/type changes if current pick has no
  // data. Keeping it in render rather than useEffect avoids a flash
  // of "no rows" before the effect fires.
  const effectiveDivision =
    division && divisions.includes(division)
      ? division
      : (divisions[0] ?? "");

  const block = all.find(
    (b) =>
      b.season === season &&
      b.game_type === type &&
      b.division === effectiveDivision,
  );

  return (
    <section className="le-hist-card">
      <div className="le-hist-pickers">
        <Picker
          label="Season"
          value={season}
          onChange={setSeason}
          options={seasons.map((s) => ({ value: s, label: s }))}
        />
        <Picker
          label="Type"
          value={type}
          onChange={(v) => setType(v as "season" | "playoff")}
          options={[
            { value: "season", label: "Regular Season" },
            { value: "playoff", label: "Playoffs" },
          ]}
        />
        <Picker
          label="Division"
          value={effectiveDivision}
          onChange={setDivision}
          options={divisions.map((d) => ({
            value: d,
            label: d || "(no division)",
          }))}
        />
      </div>

      {block ? (
        <>
          <h3 className="le-hist-block-hd">
            {block.season} ·{" "}
            {block.game_type === "season" ? "Regular Season" : "Playoffs"}
            {block.division ? ` · ${block.division}` : ""}
          </h3>
          <StandingsTable rows={block.standings} nameIdx={nameIdx} />
        </>
      ) : (
        <p className="le-hist-empty">
          No standings recorded for that combination.
        </p>
      )}
    </section>
  );
}

function StandingsTable({
  rows,
  nameIdx,
}: {
  rows: StandingRow[];
  nameIdx: Record<string, TeamMeta>;
}) {
  if (rows.length === 0)
    return <p className="le-hist-empty">No rows.</p>;
  return (
    <div className="le-hist-tbl-wrap">
      <table className="le-hist-tbl">
        <thead>
          <tr>
            <th className="left">Team</th>
            <th>W</th>
            <th>L</th>
            <th>T</th>
            <th>G</th>
            <th>PCT</th>
            <th>P</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const meta = nameIdx[r.team.trim().toLowerCase()] ?? null;
            return (
              <tr key={`${r.team}-${i}`} className={i === 0 ? "top" : ""}>
                <td className="left">
                  <span className="le-tbl-team">
                    {i === 0 && (
                      <span className="le-tbl-trophy" aria-hidden="true">
                        🏆
                      </span>
                    )}
                    {meta?.logoUrl && (
                      <img
                        src={meta.logoUrl}
                        alt=""
                        className="le-tbl-logo"
                        loading="lazy"
                      />
                    )}
                    {meta ? (
                      <Link href={`/teams/${meta.id}`}>{r.team}</Link>
                    ) : (
                      r.team
                    )}
                  </span>
                </td>
                <td>{r.w}</td>
                <td>{r.l}</td>
                <td>{r.t}</td>
                <td>{r.g}</td>
                <td>{r.pct}</td>
                <td>{r.p}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Reusable bits ──────────────────────────────────────────────────

function Picker({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="le-hist-picker">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Leaderboard({
  rows,
  unitSingular,
  unitPlural,
}: {
  rows: LeaderboardRow[];
  unitSingular: string;
  unitPlural: string;
}) {
  if (rows.length === 0) return <p className="le-hist-empty">None yet.</p>;
  const max = rows[0]!.count;
  return (
    <ol className="le-lb">
      {rows.map((r, i) => {
        const accent = r.meta?.color ?? "var(--brand-primary)";
        const widthPct = max > 0 ? Math.max(8, (r.count / max) * 100) : 0;
        const isTeamPage = r.meta != null;
        const teamNode = (
          <span className="le-lb-team">
            {r.meta?.logoUrl ? (
              <img
                src={r.meta.logoUrl}
                alt=""
                className="le-lb-logo"
                loading="lazy"
              />
            ) : (
              <span
                className="le-lb-logo le-lb-logo-fallback"
                aria-hidden="true"
                style={{ background: accent }}
              >
                {initials(r.team)}
              </span>
            )}
            <span className="le-lb-name">{r.team}</span>
          </span>
        );
        return (
          <li key={r.team} className="le-lb-row">
            <span className="le-lb-rank">{i + 1}</span>
            {isTeamPage ? (
              <Link href={`/teams/${r.meta!.id}`} className="le-lb-link">
                {teamNode}
              </Link>
            ) : (
              teamNode
            )}
            <span className="le-lb-count">
              <span className="le-lb-num">{r.count}</span>
              <span className="le-lb-unit">
                {r.count === 1 ? unitSingular : unitPlural}
              </span>
            </span>
            {/* One uniform gold bar on EVERY row (width = share of the leader's
                total). Was tinted per-team, but `${accent}33` is only valid when
                accent is a hex — the var() fallback produced invalid CSS, so
                only current-team matches got a bar and the rest looked bare. */}
            <span
              className="le-lb-bar"
              style={{ width: `${widthPct}%` }}
              aria-hidden="true"
            />
          </li>
        );
      })}
    </ol>
  );
}

// ── helpers ────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function uniqueSeasons(all: StandingsBlock[]): string[] {
  return [...new Set(all.map((b) => b.season))].sort(
    (a, b) => seasonKey(b) - seasonKey(a),
  );
}

function seasonKey(s: string): number {
  const m = /^(\w+(?:\s\w+)?)\s*-\s*(\d{4})$/.exec(s);
  if (!m) return 0;
  const tier =
    m[1] === "Florida Cup" ? 1
    : m[1] === "Spring" ? 2
    : m[1] === "Summer" ? 3
    : m[1] === "Fall" ? 4
    : 0;
  return parseInt(m[2]!, 10) * 10 + tier;
}

function divisionSort(a: string, b: string): number {
  const order = [
    "Premier Division",
    "18+ Division",
    "28+ Division",
    "35+ Division",
    "",
  ];
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b);
}

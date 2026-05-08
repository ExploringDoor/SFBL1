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
import { useMemo, useState } from "react";
import type {
  ChampionRow,
  HistoryViewProps,
  LeaderboardRow,
  StandingRow,
  StandingsBlock,
  TeamMeta,
} from "./types";

type TabId = "champions" | "records" | "standings";

export function HistoryView(props: HistoryViewProps) {
  const [tab, setTab] = useState<TabId>("champions");

  return (
    <>
      <StatsStrip stats={props.stats} />

      <nav className="le-hist-tabs" role="tablist" aria-label="History sections">
        <TabButton id="champions" current={tab} onSelect={setTab}>
          🏆 Champions
        </TabButton>
        <TabButton id="records" current={tab} onSelect={setTab}>
          📊 Records
        </TabButton>
        <TabButton id="standings" current={tab} onSelect={setTab}>
          📋 Standings
        </TabButton>
      </nav>

      <div className="le-hist-panel" role="tabpanel">
        {tab === "champions" && (
          <ChampionsTab
            champions={props.champions}
            leaderboard={props.championsLb}
          />
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

// ── Stats strip (always-visible KPIs) ──────────────────────────────

function StatsStrip({ stats }: { stats: HistoryViewProps["stats"] }) {
  return (
    <div className="le-hist-stats">
      <Stat label="Seasons" value={String(stats.seasonCount)} />
      <Stat label="Since" value={stats.oldestYear} />
      <Stat label="Champions" value={String(stats.totalChampionships)} />
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
}: {
  champions: ChampionRow[];
  leaderboard: LeaderboardRow[];
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
              <span aria-hidden="true">🏆</span> Wall of Champions
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
              No champions match "{filter}".
            </p>
          ) : (
            <ol className="le-champ-list">
              {filteredChamps.map((row) => (
                <ChampionRowView key={row.season} row={row} />
              ))}
            </ol>
          )}
        </section>

        <section className="le-hist-card">
          <header className="le-hist-card-hd">
            <h2>Most Championships</h2>
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

function ChampionRowView({ row }: { row: ChampionRow }) {
  return (
    <li className="le-champ-row">
      <span className="le-champ-season">{row.season}</span>
      <span className="le-champ-divs">
        {row.divisions.map((d) => (
          <ChampBadge
            key={d.division}
            division={d.division}
            team={d.team}
            meta={d.meta}
          />
        ))}
      </span>
    </li>
  );
}

function ChampBadge({
  division,
  team,
  meta,
}: {
  division: string;
  team: string;
  meta: TeamMeta | null;
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
        <span className="le-champ-div">{division || "—"}</span>
        <span className="le-champ-team">{team}</span>
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
            <span
              className="le-lb-bar"
              style={{
                width: `${widthPct}%`,
                background: `linear-gradient(90deg, ${accent}33, ${accent}aa)`,
              }}
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

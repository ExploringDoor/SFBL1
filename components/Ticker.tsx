"use client";

// Top ticker. Two modes:
//   • default  — one league-wide row of game tiles (small/flat leagues, SFBL)
//   • tabbed   — age-group tabs; pick an age and that age's ticker shows
//                (big youth leagues like COYBL, where a global ticker is noise)
// Each tile links to the game's box score / preview.

import Link from "next/link";
import { useState } from "react";

export interface TickerGame {
  id: string;
  date: string | null;
  status: string;
  away_team_id: string;
  home_team_id: string;
  away_score: number;
  home_score: number;
  away_team: { name: string; abbrev?: string; color?: string; logoUrl?: string | null };
  home_team: { name: string; abbrev?: string; color?: string; logoUrl?: string | null };
  away_record?: string;
  home_record?: string;
}

export interface AgeTicker {
  ageGroup: string;
  games: TickerGame[];
}

export function Ticker({
  games,
  byAge,
}: {
  games?: TickerGame[];
  byAge?: AgeTicker[];
}) {
  if (byAge && byAge.length > 0) return <TabbedTicker byAge={byAge} />;
  if (!games || games.length === 0) return null;
  return (
    <div className="ticker">
      <div className="ticker-track">
        {games.map((g) => (
          <TickerItem key={g.id} g={g} />
        ))}
      </div>
    </div>
  );
}

function TabbedTicker({ byAge }: { byAge: AgeTicker[] }) {
  const [sel, setSel] = useState(byAge[0]!.ageGroup);
  const active = byAge.find((a) => a.ageGroup === sel) ?? byAge[0]!;

  return (
    <div className="ticker">
      <div className="ticker-track" style={{ alignItems: "stretch" }}>
        {/* Age-group tabs — pick one and its ticker shows. */}
        <div
          role="tablist"
          aria-label="Scores by age group"
          style={{
            display: "flex",
            gap: 4,
            alignItems: "center",
            paddingRight: 10,
            marginRight: 6,
            borderRight: "1px solid rgba(255,255,255,0.15)",
            flexShrink: 0,
          }}
        >
          {byAge.map((a) => {
            const isActive = a.ageGroup === sel;
            return (
              <button
                key={a.ageGroup}
                role="tab"
                aria-selected={isActive}
                onClick={() => setSel(a.ageGroup)}
                style={{
                  appearance: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 10px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: "0.03em",
                  background: isActive ? "var(--brand-accent, #c8102e)" : "rgba(255,255,255,0.10)",
                  color: "#fff",
                  whiteSpace: "nowrap",
                }}
              >
                {a.ageGroup}
              </button>
            );
          })}
        </div>

        {active.games.length === 0 ? (
          <span
            style={{
              alignSelf: "center",
              color: "rgba(255,255,255,0.6)",
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            No games for {active.ageGroup} yet.
          </span>
        ) : (
          active.games.map((g) => <TickerItem key={g.id} g={g} />)
        )}
      </div>
    </div>
  );
}

function TickerItem({ g }: { g: TickerGame }) {
  const isFinal = g.status === "final" || g.status === "approved";
  const dateLabel = g.date ? formatDateShort(g.date) : "TBD";
  const statusLabel = isFinal
    ? "FINAL"
    : g.date
      ? formatTime(g.date)
      : g.status.toUpperCase();
  const awayLabel = g.away_team.abbrev ?? g.away_team_id.slice(0, 3).toUpperCase();
  const homeLabel = g.home_team.abbrev ?? g.home_team_id.slice(0, 3).toUpperCase();
  const awayWon = isFinal && g.away_score > g.home_score;
  const homeWon = isFinal && g.home_score > g.away_score;

  return (
    <Link href={`/games/${g.id}`} className="ticker-item">
      <div className="ti-head">
        <span className="ti-date">{dateLabel}</span>
        <span className="ti-sep" aria-hidden>
          ·
        </span>
        <span className="ti-status">{statusLabel}</span>
      </div>
      <TickerTeamRow
        abbrev={awayLabel}
        record={g.away_record}
        value={isFinal ? g.away_score : ""}
        winner={awayWon}
        showValue={isFinal}
      />
      <TickerTeamRow
        abbrev={homeLabel}
        record={g.home_record}
        value={isFinal ? g.home_score : ""}
        winner={homeWon}
        showValue={isFinal}
      />
    </Link>
  );
}

function TickerTeamRow({
  abbrev,
  record,
  value,
  winner,
  showValue,
}: {
  abbrev: string;
  record?: string;
  value: number | string;
  winner: boolean;
  showValue: boolean;
}) {
  return (
    <div className={"ti-row " + (winner ? "ti-row-win" : "")}>
      <span className="ti-team">{abbrev}</span>
      {record && <span className="ti-record">({record})</span>}
      {showValue && <span className="ti-val">{value}</span>}
    </div>
  );
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

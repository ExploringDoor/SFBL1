// DVSL-style top ticker. Each tile is a clickable link to the game's
// box score / preview.

import Link from "next/link";

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

export function Ticker({ games }: { games: TickerGame[] }) {
  if (games.length === 0) return null;
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

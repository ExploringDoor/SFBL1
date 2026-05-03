// DVSL-style top ticker. Plain text strip with team/score for each game,
// scrolling left infinitely. Doubles its content for a seamless loop.

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
  const date = g.date ? formatDate(g.date) : "TBD";
  const awayLabel = g.away_team.abbrev ?? g.away_team_id.slice(0, 3).toUpperCase();
  const homeLabel = g.home_team.abbrev ?? g.home_team_id.slice(0, 3).toUpperCase();
  const awayValue = isFinal ? g.away_score : g.away_record ?? "";
  const homeValue = isFinal ? g.home_score : g.home_record ?? "";
  return (
    <div className="ticker-item">
      <span style={{ opacity: 0.7 }}>{date}</span>
      <span className="ticker-sep">·</span>
      <span>
        {awayLabel} {awayValue}
      </span>
      <span className="ticker-sep">@</span>
      <span>
        {homeLabel} {homeValue}
      </span>
      <span className="ticker-sep">|</span>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const day = d.getDate();
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${month} ${day} · ${time}`;
}

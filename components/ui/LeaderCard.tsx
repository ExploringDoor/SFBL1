"use client";

// Leaderboard card — verbatim port of DVSL `.ldr-card`
// (~/Desktop/softball-site/index.html lines 954–968).
//
// One per stat (Batting Avg, HR, RBI, etc.). Big leader callout up
// top, then 2–3 runners under a top border. Whole card is a Link
// to the leader's player page.

import Link from "next/link";
import { useRouter } from "next/navigation";
import "./LeaderCard.css";

export interface LeaderRow {
  player_id: string;
  player_name: string;
  team_id?: string;
  team_name?: string;
  /** Pre-formatted display value (e.g. ".342" or "12"). */
  value: string;
}

export interface LeaderCardProps {
  /** Stat label, e.g. "Batting Avg". Rendered uppercase. */
  category: string;
  /** Top row — gets the big callout treatment. */
  leader: LeaderRow;
  /** Up to 3 runners-up shown under the divider. */
  runners?: LeaderRow[];
  /** Adds the gold gradient background variant. */
  highlighted?: boolean;
}

export function LeaderCard({
  category,
  leader,
  runners = [],
  highlighted = false,
}: LeaderCardProps) {
  const router = useRouter();
  return (
    <div
      className={"le-ldr-card" + (highlighted ? " gold" : "")}
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/players/${leader.player_id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/players/${leader.player_id}`);
        }
      }}
    >
      <div className="le-ldr-cat">{category}</div>
      <div className="le-ldr-ghost" aria-hidden>
        {leader.value}
      </div>
      <div className="le-ldr-val">{leader.value}</div>
      <div className="le-ldr-name">{leader.player_name}</div>
      {leader.team_name && (
        <div className="le-ldr-team">{leader.team_name}</div>
      )}

      {runners.length > 0 && (
        <div className="le-ldr-runners">
          {runners.map((r, i) => (
            <div key={r.player_id} className="le-rrow">
              <span className="le-rpos">{i + 2}</span>
              <Link
                href={`/players/${r.player_id}`}
                className="le-rname"
                onClick={(e) => e.stopPropagation()}
              >
                {r.player_name}
              </Link>
              <span className="le-rval">{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function LeaderGrid({ children }: { children: React.ReactNode }) {
  return <div className="le-leaders-grid">{children}</div>;
}

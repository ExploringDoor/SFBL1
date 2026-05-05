"use client";

// Sortable stats table — click a column header to re-sort.
//
// Server Components can't pass functions to Client Component props
// (Next throws "Event handlers cannot be passed to Client Component
// props"). So this component takes pre-baked, serializable rows:
//   - row.values[key] = number used for sorting
//   - row.display[key] = string shown in the cell
//   - row.team (optional) = pre-rendered ReactNode (serializable JSX)
// The caller does the work of computing values + display on the
// server; this component only re-sorts and re-renders.

import Link from "next/link";
import { useState } from "react";

export interface StatsCol {
  /** Column key — must match keys in row.values / row.display. */
  key: string;
  /** Display label, rendered uppercase. */
  label: string;
  /** false → ascending sort makes "best" first (e.g. ERA). Default true. */
  higherBetter?: boolean;
}

export interface StatsRow {
  id: string;
  name: string;
  /** Pre-rendered team cell (logo + abbrev). Rendered to the left of stats. */
  team?: React.ReactNode;
  values: Record<string, number>;
  display: Record<string, string>;
}

export interface SortableStatsTableProps {
  rows: StatsRow[];
  columns: StatsCol[];
  /** Initial sort column key. */
  defaultSort: string;
  /** Path prefix for the per-row link (default "/players"). */
  linkPrefix?: string;
}

export function SortableStatsTable({
  rows,
  columns,
  defaultSort,
  linkPrefix = "/players",
}: SortableStatsTableProps) {
  const [sortKey, setSortKey] = useState(defaultSort);

  const col = columns.find((c) => c.key === sortKey) ?? columns[0]!;
  const higher = col.higherBetter !== false;
  const sorted = [...rows].sort((a, b) => {
    const av = a.values[col.key] ?? 0;
    const bv = b.values[col.key] ?? 0;
    return higher ? bv - av : av - bv;
  });
  const showTeam = rows.some((r) => r.team != null);

  return (
    <div className="le-stats-tbl-wrap">
      <table className="le-stats-tbl">
        <thead>
          <tr>
            <th className="le-stats-th-player">Player</th>
            {showTeam && <th className="le-stats-th-team">Team</th>}
            {columns.map((c) => (
              <th
                key={c.key}
                onClick={() => setSortKey(c.key)}
                className={
                  "le-stats-th-num" + (sortKey === c.key ? " sorted" : "")
                }
                aria-sort={
                  sortKey === c.key
                    ? higher
                      ? "descending"
                      : "ascending"
                    : "none"
                }
              >
                {c.label}
                {sortKey === c.key && (
                  <span className="le-stats-arrow" aria-hidden>
                    {higher ? " ▼" : " ▲"}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td className="le-stats-td-player">
                <Link href={`${linkPrefix}/${r.id}`}>{r.name}</Link>
              </td>
              {showTeam && <td className="le-stats-td-team">{r.team}</td>}
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={
                    "le-stats-td-num" + (sortKey === c.key ? " sorted" : "")
                  }
                >
                  {r.display[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

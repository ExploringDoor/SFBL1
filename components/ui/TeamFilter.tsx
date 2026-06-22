"use client";

// Team filter for /scores — pick a team to see every game they played
// this season, in chronological order (Adam, 2026-06: helps spot
// miscounts/duplicates). Same dropdown UX as DivisionFilter; navigates
// via ?team=<id> so the URL stays the source of truth.

import { useRouter } from "next/navigation";

interface Props {
  teams: { id: string; name: string }[];
  active: string | null;
  basePath: string;
}

export function TeamFilter({ teams, active, basePath }: Props) {
  const router = useRouter();
  const value = active ?? "all";

  function go(next: string) {
    const href =
      next === "all"
        ? basePath
        : `${basePath}?team=${encodeURIComponent(next)}`;
    router.push(href);
  }

  return (
    <div className="le-teamf-wrap">
      <label htmlFor="le-teamf-select" className="le-teamf-label">
        Team
      </label>
      <div className="le-teamf-shell">
        <select
          id="le-teamf-select"
          className="le-teamf-select"
          value={value}
          onChange={(e) => go(e.target.value)}
        >
          <option value="all">All teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span aria-hidden className="le-teamf-caret">
          ▾
        </span>
      </div>
      <style jsx>{`
        .le-teamf-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 8px 0;
        }
        .le-teamf-label {
          font-family: var(--font-barlow), "Barlow Condensed", sans-serif;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .le-teamf-shell {
          position: relative;
          display: inline-flex;
          align-items: center;
        }
        .le-teamf-select {
          appearance: none;
          -webkit-appearance: none;
          -moz-appearance: none;
          background: var(--card);
          color: var(--text-strong);
          border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
          border-radius: 10px;
          padding: 9px 36px 9px 14px;
          font-size: 14px;
          font-weight: 600;
          font-family: inherit;
          letter-spacing: 0.01em;
          cursor: pointer;
          min-width: 200px;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .le-teamf-select:hover {
          border-color: var(--brand-primary);
        }
        .le-teamf-select:focus {
          outline: none;
          border-color: var(--brand-primary);
          box-shadow: 0 0 0 3px rgba(0, 45, 114, 0.15);
        }
        .le-teamf-caret {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 12px;
          color: var(--muted);
          pointer-events: none;
        }
        @media (max-width: 700px) {
          .le-teamf-select {
            min-width: 0;
            flex: 1 1 auto;
            font-size: 16px;
          }
          .le-teamf-wrap {
            flex-wrap: wrap;
          }
        }
      `}</style>
    </div>
  );
}

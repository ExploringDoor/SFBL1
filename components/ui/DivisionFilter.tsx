"use client";

// Division filter — used on /scores and /schedule.
//
// Was a row of pill-chips; Adam asked for a dropdown so it stops
// wrapping awkwardly on phones when the league has 4+ divisions.
// A native <select> renders as the OS picker on mobile (nice big
// touch target) and a normal dropdown on desktop, while remaining
// accessible (keyboard arrows, screen reader labels) with zero
// extra deps. The component is client-side only because it
// navigates on change via useRouter — keeps the URL the source of
// truth so reloads and back/forward still work, exactly like the
// chip version did.

import { useRouter } from "next/navigation";

interface Props {
  /** All distinct divisions present in the current dataset. */
  divisions: string[];
  /** The active division, or null for "All". */
  active: string | null;
  /** The path the chips link to — e.g. "/scores" or "/schedule". */
  basePath: string;
}

export function DivisionFilter({ divisions, active, basePath }: Props) {
  const router = useRouter();
  const value = active ?? "all";

  function go(next: string) {
    // Merge into the existing query (week/team) instead of replacing it,
    // so changing division keeps the selected week. Read window.location
    // only inside this click handler to stay SSR/hydration-safe.
    const p = new URLSearchParams(window.location.search);
    if (next === "all") p.delete("div");
    else p.set("div", next);
    const qs = p.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }

  return (
    <div className="le-division-wrap">
      <label htmlFor="le-division-select" className="le-division-label">
        Division
      </label>
      <div className="le-division-select-shell">
        <select
          id="le-division-select"
          className="le-division-select"
          value={value}
          onChange={(e) => go(e.target.value)}
        >
          <option value="all">All divisions</option>
          {divisions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <span aria-hidden className="le-division-caret">
          ▾
        </span>
      </div>
      <style jsx>{`
        .le-division-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 24px 0 8px;
        }
        .le-division-label {
          font-family: var(--font-barlow), "Barlow Condensed", sans-serif;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .le-division-select-shell {
          position: relative;
          display: inline-flex;
          align-items: center;
        }
        .le-division-select {
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
          min-width: 180px;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .le-division-select:hover {
          border-color: var(--brand-primary);
        }
        .le-division-select:focus {
          outline: none;
          border-color: var(--brand-primary);
          box-shadow: 0 0 0 3px rgba(0, 45, 114, 0.15);
        }
        .le-division-caret {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 12px;
          color: var(--muted);
          pointer-events: none;
        }
        @media (max-width: 700px) {
          .le-division-select {
            min-width: 0;
            flex: 1 1 auto;
            font-size: 16px; /* iOS-no-zoom */
          }
          .le-division-wrap {
            flex-wrap: wrap;
            margin: 18px 0 6px;
          }
        }
      `}</style>
    </div>
  );
}

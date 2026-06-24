"use client";

// Age-group filter — used on /scores and /schedule for age-grouped
// tenants (COYBL, 7U–14U). Mirrors DivisionFilter (a native <select> so
// it's a big OS picker on phones, keyboard/screen-reader accessible, and
// keeps the URL the source of truth via ?age=). Division is COYBL's
// sub-tier WITHIN an age, so for these leagues age is the primary axis a
// parent filters on ("show me just my kid's age group").

import { useRouter } from "next/navigation";

interface Props {
  /** All distinct age groups present, pre-sorted (7U, 8U, … 14U). */
  ages: string[];
  /** The active age group, or null for "All". */
  active: string | null;
  /** The path to navigate — e.g. "/scores" or "/schedule". */
  basePath: string;
}

export function AgeFilter({ ages, active, basePath }: Props) {
  const router = useRouter();
  const value = active ?? "all";

  function go(next: string) {
    const href =
      next === "all" ? basePath : `${basePath}?age=${encodeURIComponent(next)}`;
    router.push(href);
  }

  return (
    <div className="le-age-wrap">
      <label htmlFor="le-age-select" className="le-age-label">
        Age Group
      </label>
      <div className="le-age-select-shell">
        <select
          id="le-age-select"
          className="le-age-select"
          value={value}
          onChange={(e) => go(e.target.value)}
        >
          <option value="all">All ages</option>
          {ages.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <span aria-hidden className="le-age-caret">
          ▾
        </span>
      </div>
      <style jsx>{`
        .le-age-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 24px 0 8px;
        }
        .le-age-label {
          font-family: var(--font-barlow), "Barlow Condensed", sans-serif;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .le-age-select-shell {
          position: relative;
          display: inline-flex;
          align-items: center;
        }
        .le-age-select {
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
        .le-age-select:hover {
          border-color: var(--brand-primary);
        }
        .le-age-select:focus {
          outline: none;
          border-color: var(--brand-primary);
          box-shadow: 0 0 0 3px rgba(0, 45, 114, 0.15);
        }
        .le-age-caret {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 12px;
          color: var(--muted);
          pointer-events: none;
        }
        @media (max-width: 700px) {
          .le-age-select {
            min-width: 0;
            flex: 1 1 auto;
            font-size: 16px; /* iOS-no-zoom */
          }
          .le-age-wrap {
            flex-wrap: wrap;
            margin: 18px 0 6px;
          }
        }
      `}</style>
    </div>
  );
}

"use client";

// Interactive Teams browser (Windmill): filter the roster to one age group and
// switch between the logo-tile grid and a compact list, so a visitor isn't
// scrolling past every division to find one team. Ken Walters asked for this
// (email via Barb, 2026-08); modelled on a benefits-portal tile/list toggle.
//
// Server-agnostic: the page hands it a flat, already-sorted team list with a
// display label + sort order per division. Only Windmill renders it today; the
// rest of the platform keeps the server-rendered grid untouched.

import { useEffect, useState } from "react";
import Link from "next/link";
import { TeamBadge } from "@/components/TeamBadge";

export interface BrowserTeam {
  id: string;
  name: string;
  abbrev?: string;
  division: string; // raw grouping key, e.g. "U14"
  divLabel: string; // display label, e.g. "14U"
  divOrder: number;
  color?: string;
  logoUrl?: string | null;
  record: string;
  points: number | null;
}

const VIEW_KEY = "wf:teamsView";

export function TeamsBrowser({
  teams,
  usePoints,
}: {
  teams: BrowserTeam[];
  usePoints: boolean;
}) {
  // Unique divisions in age order (from the order the page already sorted by).
  const divs = [
    ...new Map(
      teams.map((t) => [
        t.division,
        { value: t.division, label: t.divLabel, order: t.divOrder },
      ]),
    ).values(),
  ].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

  const [age, setAge] = useState<string>("all");
  const [view, setView] = useState<"tiles" | "list">("tiles");

  // Remember the viewer's tile/list choice across visits (per-device only).
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(VIEW_KEY);
      if (v === "tiles" || v === "list") setView(v);
    } catch {
      /* ignore */
    }
  }, []);
  function chooseView(v: "tiles" | "list") {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  }

  const shown = age === "all" ? divs : divs.filter((d) => d.value === age);

  return (
    <div>
      <div className="wf-teamctl">
        <div
          className="wf-teamctl-filter"
          role="group"
          aria-label="Filter by age group"
        >
          <button
            type="button"
            className={"wf-teamctl-pill" + (age === "all" ? " active" : "")}
            aria-pressed={age === "all"}
            onClick={() => setAge("all")}
          >
            All Teams
          </button>
          {divs.map((d) => (
            <button
              key={d.value}
              type="button"
              className={"wf-teamctl-pill" + (age === d.value ? " active" : "")}
              aria-pressed={age === d.value}
              onClick={() => setAge(d.value)}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className="wf-teamctl-view" role="group" aria-label="Change view">
          <button
            type="button"
            className={"wf-teamctl-vbtn" + (view === "tiles" ? " active" : "")}
            aria-pressed={view === "tiles"}
            onClick={() => chooseView("tiles")}
          >
            <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
              <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
              <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
              <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
            </svg>
            Tiles
          </button>
          <button
            type="button"
            className={"wf-teamctl-vbtn" + (view === "list" ? " active" : "")}
            aria-pressed={view === "list"}
            onClick={() => chooseView("list")}
          >
            <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M8 6h12M8 12h12M8 18h12" />
              <circle cx="4" cy="6" r="1.1" fill="currentColor" stroke="none" />
              <circle cx="4" cy="12" r="1.1" fill="currentColor" stroke="none" />
              <circle cx="4" cy="18" r="1.1" fill="currentColor" stroke="none" />
            </svg>
            List
          </button>
        </div>
      </div>

      <div className="space-y-8" style={{ marginTop: 22 }}>
        {shown.map((d) => {
          const list = teams.filter((t) => t.division === d.value);
          return (
            <section key={d.value}>
              <h3 className="wf-team-divhead">
                {d.label}
                <span className="wf-team-divcount">{list.length}</span>
              </h3>

              {view === "tiles" ? (
                <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {list.map((t) => (
                    <Link
                      key={t.id}
                      href={`/teams/${t.id}`}
                      className="block group"
                      style={{ textAlign: "center", padding: "8px 4px" }}
                    >
                      <div
                        style={{
                          width: 112,
                          height: 112,
                          margin: "0 auto 14px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <TeamBadge
                          teamId={t.id}
                          name={t.name}
                          initials={t.abbrev}
                          color={t.color}
                          logoUrl={t.logoUrl}
                          size="card"
                        />
                      </div>
                      <div
                        className="font-oswald"
                        style={{
                          fontSize: 18,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          lineHeight: 1.1,
                          color: "var(--text-strong)",
                        }}
                      >
                        {t.name}
                      </div>
                      <div
                        className="font-barlow"
                        style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}
                      >
                        {t.record}
                        {t.points != null && (
                          <span style={{ marginLeft: 8, color: "var(--brand-primary)", fontWeight: 800 }}>
                            {t.points} PTS
                          </span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="wf-teamlist">
                  {list.map((t) => (
                    <Link key={t.id} href={`/teams/${t.id}`} className="wf-teamlist-row">
                      <span className="wf-teamlist-logo">
                        <TeamBadge
                          teamId={t.id}
                          name={t.name}
                          initials={t.abbrev}
                          color={t.color}
                          logoUrl={t.logoUrl}
                          size="md"
                        />
                      </span>
                      <span className="wf-teamlist-name">{t.name}</span>
                      <span className="wf-teamlist-rec">
                        {t.record}
                        {t.points != null && (
                          <b> · {t.points} PTS</b>
                        )}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

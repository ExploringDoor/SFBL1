"use client";

// Client half of the League Archive: fetches the recovered-pages dataset
// and provides search / section filtering / expand-to-read. The whole
// archive is read-only and infinitely cacheable, so it's one fetch and all
// filtering happens in memory — no round-trips as the visitor browses.

import { useEffect, useMemo, useState } from "react";

interface ArchiveDoc {
  s: string; // slug
  t: string; // title
  d: string; // date (may be "")
  c: string; // category key
  m: string[]; // teams mentioned
  b: string; // body text
  u: string; // original url
}

const SECTIONS: { key: string; label: string; blurb: string }[] = [
  {
    key: "story",
    label: "Stories & Recaps",
    blurb: "Game write-ups, championship recaps and season reviews.",
  },
  {
    key: "stats",
    label: "Stats & Leaderboards",
    blurb: "Season leaderboards, final standings and league stat sheets.",
  },
  {
    key: "pow",
    label: "Players of the Week",
    blurb: "Weekly player honors across the seasons.",
  },
  {
    key: "history",
    label: "Team & Season History",
    blurb: "Franchise records and season-by-season results.",
  },
  {
    key: "team",
    label: "Team Pages & Events",
    blurb: "Team pages, tournaments, all-star games and league notices.",
  },
];
const LABEL = new Map(SECTIONS.map((s) => [s.key, s.label]));
const BLURB = new Map(SECTIONS.map((s) => [s.key, s.blurb]));
const ORDER = new Map(SECTIONS.map((s, i) => [s.key, i]));

export function ArchiveView({ tenantId }: { tenantId: string }) {
  const [docs, setDocs] = useState<ArchiveDoc[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");

  useEffect(() => {
    let alive = true;
    fetch(`/${encodeURIComponent(tenantId)}/old-site-archive.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: ArchiveDoc[]) => {
        if (alive) setDocs(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [tenantId]);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const d of docs ?? []) c.set(d.c, (c.get(d.c) ?? 0) + 1);
    return c;
  }, [docs]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (docs ?? []).filter((d) => cat === "all" || d.c === cat);
    const hit = needle
      ? list.filter((d) =>
          (d.t + " " + d.b + " " + (d.m ?? []).join(" "))
            .toLowerCase()
            .includes(needle),
        )
      : list;
    return [...hit].sort(
      (a, b) =>
        (ORDER.get(a.c) ?? 9) - (ORDER.get(b.c) ?? 9) ||
        b.b.length - a.b.length,
    );
  }, [docs, q, cat]);

  if (failed) {
    return (
      <p className="arc-empty">
        No archive has been recovered for this league yet.
      </p>
    );
  }
  if (!docs) return <p className="arc-empty">Loading the archive&hellip;</p>;
  if (docs.length === 0) {
    return <p className="arc-empty">The archive is empty.</p>;
  }

  let lastCat = "";

  return (
    <>
      <div className="arc-tiles">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            className={"arc-tile" + (cat === s.key ? " on" : "")}
            onClick={() => setCat(cat === s.key ? "all" : s.key)}
          >
            <span className="fig">{counts.get(s.key) ?? 0}</span>
            <span className="lbl">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="arc-controls">
        <input
          className="arc-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search everything — team, player, season, championship…"
          aria-label="Search the archive"
        />
        <div className="arc-filters">
          <button
            type="button"
            className={"arc-pill" + (cat === "all" ? " on" : "")}
            onClick={() => setCat("all")}
          >
            All <span className="n">{docs.length}</span>
          </button>
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={"arc-pill" + (cat === s.key ? " on" : "")}
              onClick={() => setCat(s.key)}
            >
              {s.label} <span className="n">{counts.get(s.key) ?? 0}</span>
            </button>
          ))}
        </div>
        <p className="arc-count">
          {shown.length === docs.length
            ? `${docs.length} pages`
            : `${shown.length} of ${docs.length} pages`}
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="arc-empty">Nothing matches that.</p>
      ) : (
        <div>
          {shown.map((d) => {
            const head = d.c !== lastCat ? ((lastCat = d.c), true) : false;
            const meta = [d.d, (d.m ?? []).slice(0, 2).join(", ")]
              .filter(Boolean)
              .join(" · ");
            return (
              <div key={d.s}>
                {head && (
                  <>
                    <h2 className="arc-secttl">{LABEL.get(d.c) ?? d.c}</h2>
                    <p className="arc-secblurb">{BLURB.get(d.c) ?? ""}</p>
                  </>
                )}
                <details className="arc-item">
                  <summary>
                    <span className="arc-item-t">{d.t}</span>
                    {meta ? <span className="arc-item-m">{meta}</span> : null}
                  </summary>
                  <div className="arc-body">
                    {d.b}
                    {d.u ? (
                      <a
                        className="arc-src"
                        href={`https://web.archive.org/web/2023/${d.u}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View archived original ↗
                      </a>
                    ) : null}
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

"use client";

// Windmill Fastpitch field directory (tenant-gated variant of /fields). Ported from
// windmill-site/import/make_fields_page.py: one compact grid of every home field, sorted
// so same-town fields cluster, each card showing its town, a home-plate count badge of the
// teams that play there, one-tap Google Maps directions, and the team list. Search + town
// chips filter live; ?f=<field> deep-links (matches the field's normalized name variants),
// clears filters, scrolls to it, and pulses a highlight. Data comes from the seeded
// leagues/windmill/site_config/fields ({ name, town, teams[], variants[] }).

import { useEffect, useMemo, useRef, useState } from "react";
import "./FieldsWindmill.css";

export interface WindmillField {
  name: string;
  town?: string;
  teams?: string[];
  variants?: string[];
}

interface Row {
  id: string;
  name: string;
  town: string;
  teams: string[];
  variants: string[];
  search: string;
}

const norm = (s: string) =>
  (s || "").trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
const slug = (s: string) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
const mapsUrl = (dest: string) =>
  "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(dest);

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-6-5.686-6-10a6 6 0 1 1 12 0c0 4.314-6 10-6 10z" />
      <circle cx="12" cy="11" r="2.2" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export default function FieldsWindmill({ fields }: { fields: WindmillField[] }) {
  const rows: Row[] = useMemo(
    () =>
      fields
        .map((f) => {
          const teams = (f.teams ?? []).slice().sort();
          const town = (f.town ?? "").trim();
          return {
            id: "f-" + slug(f.name),
            name: f.name,
            town,
            teams,
            variants: (f.variants ?? []).map(norm),
            search: (f.name + " " + town + " " + teams.join(" ")).toLowerCase(),
          };
        })
        .sort((a, b) => a.town.localeCompare(b.town) || a.name.localeCompare(b.name)),
    [fields],
  );
  const towns = useMemo(
    () => Array.from(new Set(rows.map((r) => r.town).filter(Boolean))).sort(),
    [rows],
  );

  const [q, setQ] = useState("");
  const [town, setTown] = useState("all");
  const [hit, setHit] = useState<string | null>(null);
  const didDeepLink = useRef(false);

  const visible = rows.filter((r) => {
    const okTown = town === "all" || r.town.toLowerCase() === town;
    const s = q.trim().toLowerCase();
    const okSearch = !s || r.search.indexOf(s) > -1;
    return okTown && okSearch;
  });

  // ?f=<field> deep-link: match the game's raw location against a field's name variants,
  // clear filters so it's visible, then scroll to + pulse it. Runs once.
  useEffect(() => {
    if (didDeepLink.current) return;
    didDeepLink.current = true;
    const m = /[?&]f=([^&]+)/.exec(window.location.search);
    if (!m || !m[1]) return;
    const want = norm(decodeURIComponent(m[1].replace(/\+/g, " ")));
    const found = rows.find((r) => r.variants.indexOf(want) > -1);
    if (!found) return;
    setTown("all");
    setQ("");
    setHit(found.id);
    const id = found.id;
    window.setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  }, [rows]);

  return (
    <div className="wfields">
      <section className="wf-hero">
        <div className="wf-hero-in">
          <div className="wf-kick">Parent Resources</div>
          <h1>Field Locations</h1>
          <p>
            Every home field in the league with one-tap driving directions. Tap a game&apos;s
            location anywhere on the site and it jumps straight to that field here.
          </p>
        </div>
      </section>

      <div className="wf-controls">
        <div className="wf-controls-in">
          <div className="wf-searchwrap">
            <SearchIcon />
            <input
              className="wf-q"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search a field, town, or team…"
              aria-label="Search fields"
            />
          </div>
          <div className="wf-chips">
            <button
              type="button"
              className={"wf-chip" + (town === "all" ? " is-on" : "")}
              onClick={() => setTown("all")}
            >
              All fields
            </button>
            {towns.map((t) => (
              <button
                key={t}
                type="button"
                className={"wf-chip" + (town === t.toLowerCase() ? " is-on" : "")}
                onClick={() => setTown(t.toLowerCase())}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="wf-count">
            <b>{visible.length}</b> {visible.length === 1 ? "field" : "fields"}
          </div>
        </div>
      </div>

      <div className="wf-directory">
        <div className="wf-grid">
          {visible.map((r) => (
            <article key={r.id} id={r.id} className={"wf-card" + (hit === r.id ? " hit" : "")}>
              <div className="wf-top">
                <div>
                  <h3>{r.name}</h3>
                  <span className="wf-town">{r.town || "Wisconsin"}</span>
                </div>
                <span className="wf-cnt">
                  <b>{r.teams.length}</b>
                  <i>{r.teams.length === 1 ? "team" : "teams"}</i>
                </span>
              </div>
              <a className="wf-dir" href={mapsUrl(r.name)} target="_blank" rel="noopener noreferrer">
                <PinIcon /> Get directions
              </a>
              <div className="wf-teams">
                <span className="wf-lab">Plays here</span>
                {r.teams.join(", ")}
              </div>
            </article>
          ))}
        </div>
        {visible.length === 0 && <div className="wf-empty">No fields match that search.</div>}
        <p className="wf-foot">
          {rows.length} fields across {towns.length} communities · directions open in Google Maps.
        </p>
      </div>
    </div>
  );
}

"use client";

// Interactive fields map — the LMLL format. Every diamond the league plays at on
// one Leaflet + OpenStreetMap map (no API key), beside a searchable list. Tap a
// pin or a list row for one-tap driving directions; tapping a row flies the map
// to that field. Degrades to a list-only view if the map library can't load.
//
// Coordinates are parsed out of each field's Google Maps URL (the scrape already
// captured them), so no separate geocoding step is needed. A field with no
// resolvable coordinates still appears in the list, just without a pin.

import { useEffect, useMemo, useRef, useState } from "react";

interface Field {
  name: string;
  // Nullable to match the shared Field in FieldsDirectory: Firestore stores
  // these as null rather than undefined, and app/fields/page.tsx passes the
  // same array to both components.
  location?: string | null;
  address?: string | null;
  mapsUrl?: string | null;
  appleMapsUrl?: string | null;
  team?: string | string[] | null;
  notes?: string[];
  color?: string | null;
  lat?: number;
  lng?: number;
}
type Placed = Field & { lat: number; lng: number };

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

// Pull the first "lat,lng" out of a Google Maps URL, preferring the pinned
// destination in a /dir//<lat,lng>/ link over the map-center in an @<lat,lng>.
function parseLatLng(url?: string): [number, number] | null {
  if (!url) return null;
  const pat = /(-?\d{1,3}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/g;
  const dir = /\/dir\/\/(-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,})/.exec(url);
  const at = /@(-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,})/.exec(url);
  const m = dir ?? at ?? pat.exec(url);
  if (!m) return null;
  const lat = parseFloat(m[1]!);
  const lng = parseFloat(m[2]!);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

function directionsHref(f: Field): string {
  if (f.mapsUrl) return f.mapsUrl;
  const q = encodeURIComponent(`${f.name} ${f.address ?? ""}`.trim());
  return `https://maps.google.com/maps?q=${q}`;
}

export function FieldsMap({ fields }: { fields: Field[] }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markers = useRef<Record<string, any>>({});

  const placed: Placed[] = useMemo(() => {
    const out: Placed[] = [];
    for (const f of fields) {
      // Prefer explicit coordinates (resolved at build time); fall back to
      // parsing them out of the maps URL.
      if (typeof f.lat === "number" && typeof f.lng === "number") {
        out.push({ ...f, lat: f.lat, lng: f.lng });
        continue;
      }
      const c =
        parseLatLng(f.mapsUrl ?? undefined) ??
        parseLatLng(f.appleMapsUrl ?? undefined);
      if (c) out.push({ ...f, lat: c[0], lng: c[1] });
    }
    return out;
  }, [fields]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...fields].sort((a, b) =>
      (a.location ?? "").localeCompare(b.location ?? "") ||
      a.name.localeCompare(b.name),
    );
    if (!q) return list;
    return list.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.location ?? "").toLowerCase().includes(q) ||
        (f.address ?? "").toLowerCase().includes(q),
    );
  }, [fields, query]);

  // Load Leaflet from the CDN once, then build the map + markers.
  useEffect(() => {
    if (placed.length === 0) return;
    let cancelled = false;

    function ensureCss() {
      if (document.querySelector(`link[href="${LEAFLET_CSS}"]`)) return;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    function ensureJs(): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).L) return Promise.resolve();
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${LEAFLET_JS}"]`,
      );
      if (existing) {
        return new Promise((res) =>
          existing.addEventListener("load", () => res(), { once: true }),
        );
      }
      return new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = LEAFLET_JS;
        s.onload = () => res();
        s.onerror = () => rej(new Error("leaflet failed"));
        document.head.appendChild(s);
      });
    }

    ensureCss();
    ensureJs()
      .then(() => {
        if (cancelled || !mapEl.current || mapRef.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const L = (window as any).L;
        const map = L.map(mapEl.current, { scrollWheelZoom: false });
        mapRef.current = map;
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: "&copy; OpenStreetMap contributors",
          maxZoom: 19,
        }).addTo(map);

        const bounds: [number, number][] = [];
        for (const f of placed) {
          const m = L.marker([f.lat, f.lng]).addTo(map);
          const dir = directionsHref(f);
          m.bindPopup(
            `<strong>${escapeHtml(f.name)}</strong>` +
              (f.location ? `<br>${escapeHtml(f.location)}` : "") +
              (f.address ? `<br><span style="color:#555">${escapeHtml(f.address)}</span>` : "") +
              `<br><a href="${dir}" target="_blank" rel="noopener" style="color:#1d4ed8;font-weight:600">Directions →</a>`,
          );
          m.on("click", () => setActive(f.name));
          markers.current[f.name] = m;
          bounds.push([f.lat, f.lng]);
        }
        if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
        setMapReady(true);
      })
      .catch(() => {
        /* list-only fallback */
      });

    return () => {
      cancelled = true;
    };
  }, [placed]);

  function focusField(f: Field) {
    setActive(f.name);
    const m = markers.current[f.name];
    if (m && mapRef.current) {
      mapRef.current.flyTo(m.getLatLng(), 15, { duration: 0.6 });
      m.openPopup();
      mapEl.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  const pinnedCount = placed.length;

  return (
    <div className="fm-wrap">
      {pinnedCount > 0 && (
        <div className="fm-mapbox">
          <div ref={mapEl} className="fm-map" aria-label="Map of league fields" />
          {!mapReady && <div className="fm-map-loading">Loading map…</div>}
          <p className="fm-hint">
            Tap a pin for directions, or tap a field below to zoom to it.
          </p>
        </div>
      )}

      <div className="fm-controls">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search fields or clubs…"
          className="fm-search"
          aria-label="Search fields"
        />
        <span className="fm-count">
          {filtered.length} of {fields.length} fields
          {pinnedCount > 0 ? ` · ${pinnedCount} on map` : ""}
        </span>
      </div>

      <ul className="fm-list">
        {filtered.map((f) => {
          const hasPin = !!markers.current[f.name] || placed.some((p) => p.name === f.name);
          return (
            <li
              key={f.name + (f.address ?? "")}
              className={"fm-row" + (active === f.name ? " fm-row-on" : "")}
            >
              <button
                type="button"
                className="fm-row-main"
                onClick={() => (hasPin ? focusField(f) : setActive(f.name))}
                disabled={!hasPin}
              >
                <span className="fm-row-name">{f.name}</span>
                <span className="fm-row-sub">
                  {f.location ? <span className="fm-row-club">{f.location}</span> : null}
                  {f.address ? <span className="fm-row-addr">{f.address}</span> : null}
                </span>
              </button>
              <a
                href={directionsHref(f)}
                target="_blank"
                rel="noopener noreferrer"
                className="fm-row-dir"
              >
                Directions →
              </a>
            </li>
          );
        })}
      </ul>

      <FieldsMapStyles />
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function FieldsMapStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
      .fm-wrap { display: flex; flex-direction: column; gap: 16px; }
      .fm-mapbox { position: relative; }
      .fm-map {
        height: clamp(300px, 46vh, 460px); width: 100%; border-radius: 16px;
        border: 1px solid rgba(20,33,61,.14); overflow: hidden; z-index: 0;
        background: #e8edf2;
      }
      .fm-map-loading {
        position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        color: #5c6480; font-weight: 600; pointer-events: none;
      }
      .fm-hint { margin: 8px 2px 0; font-size: 12.5px; color: #64748b; }
      .fm-controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      .fm-search {
        flex: 1 1 260px; min-width: 200px; height: 46px; padding: 0 16px;
        border-radius: 12px; border: 1.5px solid rgba(20,33,61,.16); font-size: 15px;
        background: #fff; color: #14213d; transition: border-color .15s, box-shadow .15s;
      }
      .fm-search:focus { outline: none; border-color: var(--brand-accent,#9a8c3f);
        box-shadow: 0 0 0 4px rgba(201,162,39,.16); }
      .fm-count { font-size: 12.5px; font-weight: 700; color: #64748b; }
      .fm-list { list-style: none; margin: 0; padding: 0; display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; }
      .fm-row {
        display: flex; align-items: stretch; gap: 6px; background: #fff;
        border: 1px solid rgba(20,33,61,.1); border-radius: 12px; overflow: hidden;
        transition: border-color .14s, box-shadow .14s, transform .14s;
      }
      .fm-row-on { border-color: var(--brand-accent,#9a8c3f);
        box-shadow: 0 8px 20px -12px rgba(20,33,61,.4); }
      .fm-row-main {
        flex: 1; text-align: left; background: none; border: none; cursor: pointer;
        padding: 11px 14px; display: flex; flex-direction: column; gap: 2px; min-width: 0;
      }
      .fm-row-main:disabled { cursor: default; }
      .fm-row-name { font-weight: 800; color: #14213d; font-size: 15px; }
      .fm-row-sub { display: flex; flex-direction: column; gap: 1px; }
      .fm-row-club { font-size: 12px; font-weight: 700; color: var(--brand-accent,#9a8c3f);
        text-transform: uppercase; letter-spacing: .04em; }
      .fm-row-addr { font-size: 12.5px; color: #64748b; }
      .fm-row-dir {
        flex: 0 0 auto; display: flex; align-items: center; padding: 0 14px;
        background: var(--brand-primary,#14213d); color: #fff; font-weight: 800; font-size: 12.5px;
        text-decoration: none; white-space: nowrap; transition: filter .14s;
      }
      .fm-row-dir:hover { filter: brightness(1.15); }
      @media (max-width: 520px) { .fm-row-dir { padding: 0 12px; } }
    `,
      }}
    />
  );
}

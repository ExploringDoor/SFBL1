"use client";

// Field directory grouped by CLUB, matching how LCYBL publishes it on their own
// site: a plain club heading, then one line per field where the whole
// "Name - Address" string is a single link to its map, with any notes
// ("Portable Mound", "No Metal Cleats", "NO PETS!") following in bold after it.
//
// Deliberately not the card grid in FieldsDirectory. That groups by town and
// gives every field a card, which is right for a league with a dozen parks. At
// 123 fields across 23 clubs it becomes a wall of boxes, and — more to the
// point — it is not how this league's own directory reads. Clubs look up their
// own section; the dense list is what they already know.
//
// The one addition to their version is the filter box. It changes nothing about
// how the list looks and makes 123 fields findable.

import { useMemo, useState } from "react";
import type { Field } from "./FieldsDirectory";

export function FieldsByClub({ fields }: { fields: Field[] }) {
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const byClub = new Map<string, Field[]>();
    for (const f of fields) {
      if (
        needle &&
        !`${f.name} ${f.address ?? ""} ${f.location ?? ""}`
          .toLowerCase()
          .includes(needle)
      ) {
        continue;
      }
      const club = (f.location ?? "").trim() || "Other";
      byClub.set(club, [...(byClub.get(club) ?? []), f]);
    }
    return [...byClub.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [fields, q]);

  const shown = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <>
      <div className="fbc-tools">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by field, club or town…"
          aria-label="Filter fields"
          className="fbc-search"
        />
        <span className="fbc-count">
          {shown} field{shown === 1 ? "" : "s"} · {groups.length} club
          {groups.length === 1 ? "" : "s"}
        </span>
      </div>

      {groups.length === 0 && (
        <p className="fbc-empty">No fields match that filter.</p>
      )}

      {groups.map(([club, list]) => (
        <section className="fbc-club" key={club}>
          <h2 className="fbc-club-name">{club}</h2>
          <ul className="fbc-list">
            {list.map((f, i) => (
              <li className="fbc-row" key={`${f.name}-${i}`}>
                <FieldLine f={f} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function FieldLine({ f }: { f: Field }) {
  // "Name - Address" is ONE link, exactly as they publish it. When there is no
  // address the name alone is the link text; when there is no map URL it falls
  // back to a Google Maps search so the line still goes somewhere useful.
  const label = [f.name, f.address].filter(Boolean).join(" - ");
  const href =
    f.mapsUrl ||
    (f.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${f.name} ${f.address}`,
        )}`
      : null);
  const notes = Array.isArray(f.notes) ? f.notes.filter(Boolean) : [];

  return (
    <>
      {href ? (
        <a
          className="fbc-link"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {label}
        </a>
      ) : (
        <span className="fbc-link fbc-link-plain">{label}</span>
      )}
      {notes.length > 0 && (
        <span className="fbc-notes"> {notes.map((n) => `- ${n}`).join(" ")}</span>
      )}
    </>
  );
}

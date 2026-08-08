// Member Clubs — purpose-built club grid (LCYBL). Replaces the markdown table
// ("Club | Website") with a card per club: monogram badge, club name, and a
// real "Visit website" action (or a quiet "no website" state — Bowmansville,
// Crest and Octorara publish none). Pure server component.

import clubsData from "@/data/lcybl/clubs.json";
import styles from "./ClubsView.module.css";

interface Club {
  name: string;
  website: string | null;
}

// Deterministic monogram: first letters of the two leading words ("Conoy
// Township YAA" -> "CT"). Single-word clubs get their first two letters.
function monogram(name: string): string {
  const words = name.split(/[\s—-]+/).filter((w) => /^[A-Za-z]/.test(w));
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function ClubsView() {
  const { intro, clubs } = clubsData as { intro: string; clubs: Club[] };
  return (
    <div>
      <p className={styles.intro}>{intro}</p>
      <div className={styles.grid}>
        {clubs.map((c) => (
          <article key={c.name} className={styles.card}>
            <span className={styles.mono} aria-hidden>
              {monogram(c.name)}
            </span>
            <div className={styles.body}>
              <h3 className={styles.name}>{c.name}</h3>
              {c.website ? (
                <a
                  href={c.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.site}
                >
                  {domain(c.website)}
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              ) : (
                <span className={styles.nosite}>No website listed</span>
              )}
            </div>
          </article>
        ))}
      </div>
      <p className={styles.footnote}>
        The Field Locations page is organized under slightly different headings
        (it includes Cedar Crest, Lancaster Mennonite, and a combined Manheim
        &amp; Penryn). The two lists are related but not identical.
      </p>
    </div>
  );
}

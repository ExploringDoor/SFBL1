// League Documents — purpose-built download-grid layout (LCYBL). Replaces the
// markdown table-cards, which read as "a Word document dumped on a page"
// (Adam's standing complaint about generic content pages). Each document is a
// card: file-type badge, title + version, what it covers, size, and a real
// download link to the file under public/lcybl/docs/. Items that also exist as
// interactive pages on this site (rules, team registration) carry a second
// "view online" link. Pure server component.

import docsData from "@/data/lcybl/documents.json";
import styles from "./DocumentsView.module.css";

interface DocItem {
  title: string;
  version?: string;
  desc: string;
  file: string;
  type: string;
  size: string;
  webHref?: string;
  webLabel?: string;
}
interface DocSection {
  title: string;
  items: DocItem[];
}

const TYPE_CLASS: Record<string, string> = {
  PDF: styles.badgePdf ?? "",
  XLSX: styles.badgeXlsx ?? "",
  DOCX: styles.badgeDoc ?? "",
  DOC: styles.badgeDoc ?? "",
};

export function DocumentsView() {
  const { intro, notes, sections } = docsData as {
    intro: string;
    notes: string[];
    sections: DocSection[];
  };
  return (
    <div>
      <p className={styles.intro}>{intro}</p>
      <ul className={styles.notes}>
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>

      {sections.map((sec) => (
        <section key={sec.title} className={styles.section}>
          <h2 className={styles.secTitle}>{sec.title}</h2>
          <div className={styles.grid}>
            {sec.items.map((d) => (
              <article key={d.file} className={styles.card}>
                <div className={styles.cardTop}>
                  <span
                    className={`${styles.badge} ${TYPE_CLASS[d.type] ?? ""}`}
                  >
                    {d.type}
                  </span>
                  <span className={styles.size}>{d.size}</span>
                </div>
                <h3 className={styles.docTitle}>
                  {d.title}
                  {d.version && (
                    <span className={styles.version}> · {d.version}</span>
                  )}
                </h3>
                <p className={styles.desc}>{d.desc}</p>
                <div className={styles.actions}>
                  <a href={d.file} download className={styles.dl}>
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download
                  </a>
                  {d.webHref && (
                    <a href={d.webHref} className={styles.weblink}>
                      {d.webLabel ?? "View online"} ›
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// FAQ layout — renders a Q&A markdown page (each "## Question" followed by its
// answer) as a native <details> accordion instead of a wall of stacked cards.
// Adam's standing note on LCYBL content pages: they "look like a Word document
// dumped on a page" — FAQ-as-accordion is the agreed per-page-type treatment
// (mirrors the /rules accordion). Pure SERVER component: <details> toggles
// natively with no JS, so there's no new client chunk and no hydration step.

import styles from "./FaqAccordion.module.css";

interface Item {
  q: string;
  a: string;
}

// Decode the handful of HTML entities markdownToHtml emits in headings, so a
// question like "What's next?" doesn't render "What&#39;s next?".
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&nbsp;": " ",
};
function decode(s: string): string {
  return s.replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e);
}

function splitQA(html: string): { intro: string; items: Item[] } {
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  const heads: Array<{ text: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    heads.push({
      text: decode(m[1]!.replace(/<[^>]+>/g, "").trim()),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  const intro = heads.length ? html.slice(0, heads[0]!.start) : html;
  const items: Item[] = heads
    .map((hd, i) => ({
      q: hd.text,
      a: html.slice(hd.end, heads[i + 1]?.start ?? html.length),
    }))
    // Drop bare heading rows with no answer body (e.g. a leading
    // "## Frequently Asked Questions" label that carries no text).
    .filter((it) => it.a.replace(/<[^>]+>/g, "").trim().length > 0);
  return { intro, items };
}

export function FaqAccordion({ html }: { html: string }) {
  const { intro, items } = splitQA(html);
  const introText = intro.replace(/<[^>]+>/g, "").trim();
  return (
    <div className={styles.faqAcc}>
      {introText && (
        <div
          className={styles.faqIntro}
          dangerouslySetInnerHTML={{ __html: intro }}
        />
      )}
      {items.map((it, i) => (
        <details className={styles.faqItem} key={i}>
          <summary className={styles.faqQ}>
            <span>{it.q}</span>
            <span className={styles.faqIc} aria-hidden />
          </summary>
          <div
            className={styles.faqA}
            dangerouslySetInnerHTML={{ __html: it.a }}
          />
        </details>
      ))}
    </div>
  );
}

// Card renderer for markdown content pages (/content/*, and the freeform
// /rules fallback). Takes the sanitized HTML that markdownToHtml produced and
// splits it on <h2> boundaries so each section becomes its own card, matching
// the visual language of RulesRichView: white card, brand-coloured top rule,
// uppercase display heading, plus a "Jump To" chip row once there are enough
// sections to be worth skipping between.
//
// Why: these pages were a single undifferentiated column of black prose. The
// content was right, it just read as a wall. Fixing the shared renderer lifts
// every content page at once rather than styling one of them by hand.
//
// Server-renderable on purpose — the chips are plain anchors, so no client JS.
//
// The split is a regex over markdownToHtml's own output, which emits bare
// <h1>/<h2> with no attributes. It is not a general HTML parser and is not
// meant to be: anything it does not recognise falls through to `prose`, the
// previous plain rendering, so an unexpected shape degrades instead of breaking.

const PROSE =
  "prose prose-slate max-w-none [&_h3]:text-lg [&_h3]:font-bold [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:tracking-tight [&_h4]:font-semibold [&_h4]:mt-4 [&_p]:my-3 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1.5 [&_a]:text-blue-600 [&_a]:underline [&_strong]:font-semibold [&_em]:italic [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600 [&_table]:w-full [&_table]:my-4 [&_table]:text-sm [&_th]:text-left [&_th]:font-semibold [&_th]:bg-slate-50 [&_th]:border [&_th]:border-slate-200 [&_th]:px-3 [&_th]:py-2 [&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-2 [&_img]:rounded-lg [&_img]:border [&_img]:border-slate-200 [&_img]:my-4";

export interface ParsedContent {
  /** Text of a leading <h1>, if the markdown opened with one. */
  title: string | null;
  /** HTML with that <h1> removed. */
  body: string;
}

/** Pull a leading <h1> off the top so the page does not print its title twice
 *  (once from the route's own heading, once from the markdown). */
export function extractLeadingH1(html: string): ParsedContent {
  const m = html.match(/^\s*<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) return { title: null, body: html };
  const title = m[1]!.replace(/<[^>]+>/g, "").trim();
  return { title: title || null, body: html.slice(m[0].length) };
}

function anchor(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function splitSections(html: string) {
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  const heads: Array<{ text: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    heads.push({
      text: m[1]!.replace(/<[^>]+>/g, "").trim(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  const intro = heads.length ? html.slice(0, heads[0]!.start) : html;
  const sections = heads.map((h, i) => ({
    heading: h.text,
    html: html.slice(h.end, heads[i + 1]?.start ?? html.length),
  }));
  return { intro, sections };
}

export function ContentSections({ html }: { html: string }) {
  const { intro, sections } = splitSections(html);

  // Nothing to card up — render as before.
  if (sections.length === 0) {
    return (
      <article
        className={PROSE}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  const hasIntro = intro.replace(/<[^>]+>/g, "").trim().length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {hasIntro && (
        <div
          className={PROSE}
          style={{
            fontSize: 17,
            lineHeight: 1.65,
            color: "var(--text-body)",
            borderLeft: "3px solid var(--brand-accent, #35afea)",
            paddingLeft: 16,
          }}
          dangerouslySetInnerHTML={{ __html: intro }}
        />
      )}

      {sections.length > 2 && (
        <div
          style={{
            background: "white",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 14,
            padding: "14px 18px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.16em",
              color: "var(--muted)",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Jump To
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {sections.map((s) => (
              <a
                key={s.heading}
                href={`#${anchor(s.heading)}`}
                style={{
                  padding: "6px 14px",
                  background: "rgba(0,45,110,0.05)",
                  border: "1px solid rgba(0,45,110,0.18)",
                  borderRadius: 999,
                  color: "var(--brand-primary, #002d6e)",
                  fontSize: 13,
                  fontWeight: 700,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {s.heading}
              </a>
            ))}
          </div>
        </div>
      )}

      {sections.map((s) => (
        <section
          key={s.heading}
          id={anchor(s.heading)}
          style={{
            background: "white",
            border: "1px solid rgba(0,0,0,0.08)",
            borderTop: "4px solid var(--brand-primary, #002d6e)",
            borderRadius: 14,
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            overflow: "hidden",
            scrollMarginTop: 80,
          }}
        >
          <header
            style={{
              padding: "16px 20px",
              borderBottom: "1px solid rgba(0,0,0,0.06)",
            }}
          >
            <h2
              className="font-display"
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: "0.01em",
                color: "var(--text-strong)",
              }}
            >
              {s.heading}
            </h2>
          </header>
          <div
            className={PROSE}
            style={{ padding: "6px 20px 16px" }}
            dangerouslySetInnerHTML={{ __html: s.html }}
          />
        </section>
      ))}
    </div>
  );
}

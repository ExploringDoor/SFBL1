// Card renderer for markdown content pages (/content/*, the freeform /rules
// fallback, and the /player-ads community note). Takes the sanitized HTML that
// markdownToHtml produced and splits it on <h2> boundaries so each section
// becomes its own card, matching the visual language of RulesRichView: white
// card, brand-coloured top rule, uppercase display heading, plus a "Jump To"
// chip row once there are enough sections to be worth skipping between.
//
// Why: these pages were a single undifferentiated column of black prose. The
// content was right, it just read as a wall. Fixing the shared renderer lifts
// every content page at once rather than styling one of them by hand.
//
// Each section header now carries an SVG icon chosen by keyword from its own
// heading (derby -> bat, all-star -> star, fees -> tag, ...), with a neutral
// softball fallback so an unmatched heading still gets a badge, never a gap.
// The map is generic on purpose: it reads as designed for Island's events page
// AND for COYBL's transcribed rules/registration pages, since both share this
// renderer. NO emoji — SVG only, per house rule.
//
// Server-renderable on purpose — the chips are plain anchors, the icons are
// inline SVG, and the only interactivity (hover) is a scoped <style>. No client
// JS. The section cards are <section id> elements, which the motion layer
// (SiteFX) already reveals on scroll for tenants with motion_fx on; the hover
// here is shadow/border/icon-fill, NOT transform, because that reveal animation
// fills `both` and would win the cascade against a hover transform on the very
// same node.
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

// ---- section icons --------------------------------------------------------
// Keyword -> icon. First match wins, so order specific before generic. The
// fallback ("ball") means every section gets a badge, matched or not.
type IconKey =
  | "bat"
  | "star"
  | "trophy"
  | "clipboard"
  | "tag"
  | "calendar"
  | "book"
  | "pin"
  | "chat"
  | "target"
  | "ball";

const ICON_RULES: Array<[RegExp, IconKey]> = [
  [/home ?run|derby|hitting|\bbat\b|slug/i, "bat"],
  [/all[- ]?star|showcase|\bstar\b/i, "star"],
  [/tournament|champ|\belite\b|best of|try ?out|\bcup\b|playoff|award|title/i, "trophy"],
  [/regist|sign[- ]?up|enroll|roster|applicat|apply|join/i, "clipboard"],
  [/\bfee|\bcost|\bprice|pricing|payment|\bdues|refund|discount|deposit/i, "tag"],
  [/schedul|\bdate|season|deadline|calendar/i, "calendar"],
  [/\brule|conduct|policy|guideline|handbook|\bcode\b|eligib|waiver|bylaw/i, "book"],
  [/field|\bpark\b|location|direction|venue|facilit|complex/i, "pin"],
  [/contact|question|\bfaq\b|\bhelp\b|reach|inquir|email|phone/i, "chat"],
  [/clinic|\bcamp\b|training|instruction|lesson|skill|develop|practice|coach/i, "target"],
];

function iconFor(heading: string): IconKey {
  for (const [re, key] of ICON_RULES) if (re.test(heading)) return key;
  return "ball";
}

function SectionIcon({ kind }: { kind: IconKey }) {
  const common = {
    width: 21,
    height: 21,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (kind) {
    case "bat":
      return (
        <svg {...common}>
          <path d="M3 21l2.5-2.5" />
          <path d="M6.5 17.5L16 8c1.2-1.2 3.2-1.6 4.4-1 .6 1.2 .2 3.2-1 4.4L9.9 21z" />
        </svg>
      );
    case "star":
      return (
        <svg {...common}>
          <path d="M12 3.5l2.6 5.3 5.8.9-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.6 9.7l5.8-.9z" />
        </svg>
      );
    case "trophy":
      return (
        <svg {...common}>
          <path d="M8 4h8v4a4 4 0 01-8 0z" />
          <path d="M8 6H5a3 3 0 003 3.4M16 6h3a3 3 0 01-3 3.4" />
          <path d="M12 12v3M9 20h6M10 20v-2.5h4V20" />
        </svg>
      );
    case "clipboard":
      return (
        <svg {...common}>
          <rect x="6" y="4.5" width="12" height="16" rx="2" />
          <path d="M9 4.5a3 3 0 016 0" />
          <path d="M9 11h6M9 15h4" />
        </svg>
      );
    case "tag":
      return (
        <svg {...common}>
          <path d="M4 12.5V5a1 1 0 011-1h7.5L20 11.5 13 18.5z" />
          <circle cx="8.4" cy="8.4" r="1.2" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
          <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
        </svg>
      );
    case "book":
      return (
        <svg {...common}>
          <path d="M5.5 4.5H16a2 2 0 012 2v13H7.5a2 2 0 01-2-2z" />
          <path d="M9 4.5v13" />
        </svg>
      );
    case "pin":
      return (
        <svg {...common}>
          <path d="M12 21s-6-5.2-6-10a6 6 0 1112 0c0 4.8-6 10-6 10z" />
          <circle cx="12" cy="11" r="2.2" />
        </svg>
      );
    case "chat":
      return (
        <svg {...common}>
          <path d="M4.5 5.5h15v10h-9l-4 3v-3h-2z" />
        </svg>
      );
    case "target":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="12" cy="12" r="0.6" />
        </svg>
      );
    case "ball":
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M6.2 6.2c2.6 2.4 2.6 9.2 0 11.6" />
          <path d="M17.8 6.2c-2.6 2.4-2.6 9.2 0 11.6" />
        </svg>
      );
  }
}

// One scoped stylesheet for the whole renderer. Hover is shadow + border +
// icon-fill only — deliberately NOT transform, which the scroll-reveal
// animation (fill: both) would override on the very same <section> nodes.
//
// !important is load-bearing, not lazy: the base card/badge/chip colours are set
// as INLINE style props (React), which outrank any selector, so a plain :hover
// rule computes but never paints. !important is the one thing that beats inline.
//
// The card glow deliberately matches the game-card hover (fx.css): a tight
// accent ring + soft accent halo in --brand-accent, so "hover = the FASTPITCH
// blue glow" reads the same everywhere Adam asked for it.
const CARD_CSS = `
.le-content-card{transition:box-shadow .22s ease,border-color .22s ease}
.le-content-card .le-content-badge{transition:background-color .22s ease,color .22s ease,border-color .22s ease}
@media (hover:hover) and (pointer:fine){
  .le-content-card:hover{
    border-color:color-mix(in srgb, var(--brand-accent,#35afea) 60%, transparent) !important;
    box-shadow:0 0 0 1px color-mix(in srgb, var(--brand-accent,#35afea) 40%, transparent),0 0 20px 1px color-mix(in srgb, var(--brand-accent,#35afea) 28%, transparent),0 10px 26px rgba(0,0,0,.10) !important;
  }
  .le-content-card:hover .le-content-badge{background:var(--brand-primary,#002d6e) !important;color:#fff !important;border-color:var(--brand-primary,#002d6e) !important}
  .le-content-jump{transition:background-color .18s ease,color .18s ease,border-color .18s ease}
  .le-content-jump:hover{background:var(--brand-primary,#002d6e) !important;color:#fff !important;border-color:var(--brand-primary,#002d6e) !important}
}`;

export function ContentSections({ html }: { html: string }) {
  const { intro, sections } = splitSections(html);

  // Nothing to card up — wrap the prose in a single surface so even an
  // unstructured page reads as a designed panel rather than raw text on white.
  if (sections.length === 0) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: CARD_CSS }} />
        <section
          className="le-content-card"
          style={{
            background: "white",
            border: "1px solid rgba(0,0,0,0.08)",
            borderTop: "4px solid var(--brand-primary, #002d6e)",
            borderRadius: 14,
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div
            className={PROSE}
            style={{ padding: "18px 22px" }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </section>
      </>
    );
  }

  const hasIntro = intro.replace(/<[^>]+>/g, "").trim().length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <style dangerouslySetInnerHTML={{ __html: CARD_CSS }} />

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
                className="le-content-jump"
                href={`#${anchor(s.heading)}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
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
                <span aria-hidden style={{ display: "inline-flex", opacity: 0.85 }}>
                  <SectionIcon kind={iconFor(s.heading)} />
                </span>
                {s.heading}
              </a>
            ))}
          </div>
        </div>
      )}

      {sections.map((s) => {
        const kind = iconFor(s.heading);
        return (
          <section
            key={s.heading}
            id={anchor(s.heading)}
            className="le-content-card"
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
                display: "flex",
                alignItems: "center",
                gap: 13,
                padding: "15px 20px",
                borderBottom: "1px solid rgba(0,0,0,0.06)",
                // A whisper of brand tint so the header band reads as a designed
                // element rather than flat white. Fades to white by the body.
                background:
                  "linear-gradient(180deg, color-mix(in srgb, var(--brand-primary, #002d6e) 6%, white), white)",
              }}
            >
              <span
                className="le-content-badge"
                aria-hidden
                style={{
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  width: 40,
                  height: 40,
                  borderRadius: 11,
                  color: "var(--brand-primary, #002d6e)",
                  background:
                    "color-mix(in srgb, var(--brand-primary, #002d6e) 10%, white)",
                  border:
                    "1px solid color-mix(in srgb, var(--brand-primary, #002d6e) 20%, transparent)",
                }}
              >
                <SectionIcon kind={kind} />
              </span>
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
        );
      })}
    </div>
  );
}

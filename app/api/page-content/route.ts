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

  // Audit M18: no write-side rate limit here by design. Auth is a
  // verified Firebase ID token carrying leagues[leagueId]==="admin".
  // For passwordless tenants (LBDC) that claim is minted only via
  // /api/public-admin-claim, which IS rate-limited (20/IP/10min) and
  // uses a hardened constant-time compare (audit M10) — that is the
  // primary brute-force control. A per-endpoint write limiter here
  // would be inconsistent (every admin write endpoint shares this
  // posture) and could throttle a legitimate bulk content migration.
  // Platform-wide admin write throttling is a deliberate v2 decision,
  // tracked in the audit, not a per-route patch.
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
    // Closes audit M16. The MAX_BYTES cap above is checked against
    // the source payload — re-check after sanitization so a
    // payload that's small post-strip (e.g. mostly <script> tags
    // that DOMPurify nukes) doesn't sneak through, and so the
    // doc we actually persist obeys the limit. Belt-and-suspenders
    // on both sides of sanitization.
    const cleanLen = Buffer.byteLength(cleanHtml, "utf8");
    if (cleanLen > MAX_BYTES) {
      return NextResponse.json(
        { error: `sanitized html exceeds ${MAX_BYTES}-byte limit` },
        { status: 413 },
      );
    }
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
    return NextResponse.json({ ok: true, bytes: cleanLen, mode: "html" });
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

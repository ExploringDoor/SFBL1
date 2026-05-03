// POST /api/page-content — admin-only page content save.
//
// Body: { leagueId, pageId, markdown }. Verifies the caller's ID token,
// checks they hold leagues[leagueId] === 'admin', then writes the
// markdown (and a sanitized html cache) to /leagues/{leagueId}/
// page_content/{pageId}.
//
// markdown is the source of truth; we cache html for read-time speed.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { markdownToHtml } from "@/lib/markdown";

export const runtime = "nodejs";

// Cap accepted markdown size to keep request and stored doc sane.
// 200KB is plenty for a rules page; anything larger is suspicious.
const MAX_MARKDOWN_BYTES = 200_000;

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

  let body: { leagueId?: unknown; pageId?: unknown; markdown?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { leagueId, pageId, markdown } = body;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json({ error: "leagueId required" }, { status: 400 });
  }
  if (typeof pageId !== "string" || !pageId || !/^[a-z0-9_-]+$/.test(pageId)) {
    return NextResponse.json(
      { error: "pageId must be lowercase alphanumeric (with - or _)" },
      { status: 400 },
    );
  }
  if (typeof markdown !== "string") {
    return NextResponse.json({ error: "markdown must be a string" }, { status: 400 });
  }
  if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES) {
    return NextResponse.json(
      { error: `markdown exceeds ${MAX_MARKDOWN_BYTES}-byte limit` },
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

  const html = markdownToHtml(markdown);
  const db = getAdminDb();
  await db.doc(`leagues/${leagueId}/page_content/${pageId}`).set(
    {
      markdown,
      html,
      updated_at: new Date().toISOString(),
      updated_by: decoded.uid,
    },
    { merge: true },
  );

  return NextResponse.json({ ok: true, bytes: markdown.length });
}

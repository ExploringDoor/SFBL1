// /api/admin-alert — admin posts/clears the homepage banner alert.
//
// Stored at /leagues/{leagueId}/site_config/banner. One active banner
// at a time (matching the DVSL pattern at admin.html:6880). Setting
// active=false clears it; setting active=true with a new title/body
// replaces the previous alert.
//
// Body shape:
//   { leagueId, action: "publish" | "clear",
//     title?, body?, kind?, expires_at? }
//
// `kind` is one of "info" | "warning" | "critical" — drives the
// banner color. Body supports markdown (rendered through the same
// sanitizer as page content).
//
// Auth: caller must be admin of leagueId.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";
import { sanitizeHtml } from "@/lib/markdown";

export const runtime = "nodejs";

const ALLOWED_KINDS = new Set(["info", "warning", "critical"]);

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing bearer token" },
      { status: 401 },
    );
  }
  const idToken = auth.slice("Bearer ".length).trim();

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: {
    leagueId?: unknown;
    action?: unknown;
    title?: unknown;
    body?: unknown;
    kind?: unknown;
    expires_at?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const leagueId = body.leagueId;
  if (typeof leagueId !== "string" || !leagueId) {
    return NextResponse.json(
      { error: "leagueId is required" },
      { status: 400 },
    );
  }
  const callerLeagues = decoded.leagues as
    | Record<string, string>
    | undefined;
  if (callerLeagues?.[leagueId] !== "admin") {
    return NextResponse.json(
      { error: `Not admin of league "${leagueId}"` },
      { status: 403 },
    );
  }

  const db = getAdminDb();
  const ref = db.doc(`leagues/${leagueId}/site_config/banner`);
  const action = body.action;

  if (action === "clear") {
    await ref.set(
      {
        active: false,
        cleared_at: new Date().toISOString(),
        cleared_by_uid: decoded.uid,
      },
      { merge: true },
    );
    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: "alert_clear",
      by_uid: decoded.uid,
      by_role: "admin",
      changes: {},
      at: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, active: false });
  }

  if (action === "publish") {
    const title =
      typeof body.title === "string" ? body.title.trim() : "";
    // Body comes from the RichEditor as HTML — sanitize here so
    // anything that bypasses the editor's allowlist (or tries a
    // raw HTTP POST) still hits the DOMPurify gauntlet.
    const text =
      typeof body.body === "string"
        ? sanitizeHtml(body.body.trim())
        : "";
    const kind =
      typeof body.kind === "string" && ALLOWED_KINDS.has(body.kind)
        ? body.kind
        : "info";
    if (!title && !text) {
      return NextResponse.json(
        { error: "Need at least a title or body" },
        { status: 400 },
      );
    }
    const expiresAt =
      typeof body.expires_at === "string" && body.expires_at
        ? body.expires_at
        : null;

    const data = {
      active: true,
      title,
      body: text,
      kind,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
      created_by_uid: decoded.uid,
    };
    await ref.set(data);

    await db.collection(`leagues/${leagueId}/audit`).add({
      kind: "alert_publish",
      by_uid: decoded.uid,
      by_role: "admin",
      changes: { title, kind, expires_at: expiresAt },
      at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, banner: data });
  }

  return NextResponse.json(
    { error: "action must be publish | clear" },
    { status: 400 },
  );
}

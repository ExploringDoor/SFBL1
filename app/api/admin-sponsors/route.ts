// /api/admin-sponsors — admin manages the league sponsor list.
//
// Stored as an array on /leagues/{id} under the `sponsors` field.
// SiteFooter reads it via the tenant config header. Updating here
// triggers an Edge Config refresh on the next request (the cache
// TTL is 60s).
//
// Body:
//   { leagueId, sponsors: [{ name, logo_url, url? }] }
//
// Replaces the entire array — admin manages additions/removals
// client-side and POSTs the new full list. Simpler than per-item
// CRUD.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

interface Sponsor {
  name?: string;
  logo_url?: string;
  url?: string;
}

const MAX_SPONSORS = 50;
const MAX_LOGO_URL = 2_500_000; // ~1.8 MB pre-base64

export async function POST(req: Request) {
  const authHdr = req.headers.get("authorization");
  if (!authHdr?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing bearer token" },
      { status: 401 },
    );
  }
  const idToken = authHdr.slice("Bearer ".length).trim();

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  let body: { leagueId?: unknown; sponsors?: unknown };
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

  if (!Array.isArray(body.sponsors)) {
    return NextResponse.json(
      { error: "sponsors must be an array" },
      { status: 400 },
    );
  }
  const raw = body.sponsors as Sponsor[];
  if (raw.length > MAX_SPONSORS) {
    return NextResponse.json(
      { error: `Too many sponsors (max ${MAX_SPONSORS})` },
      { status: 400 },
    );
  }

  // Validate + normalize each entry.
  const cleaned: { name: string; logo_url: string; url?: string }[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i] ?? {};
    const name = typeof s.name === "string" ? s.name.trim() : "";
    const logo = typeof s.logo_url === "string" ? s.logo_url.trim() : "";
    const url = typeof s.url === "string" ? s.url.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: `Sponsor #${i + 1}: name is required` },
        { status: 400 },
      );
    }
    if (!logo) {
      return NextResponse.json(
        { error: `Sponsor "${name}": logo is required` },
        { status: 400 },
      );
    }
    const validLogo =
      logo.startsWith("/") ||
      logo.startsWith("https://") ||
      logo.startsWith("http://") ||
      logo.startsWith("data:image/");
    if (!validLogo) {
      return NextResponse.json(
        {
          error: `Sponsor "${name}" logo must start with /, https://, http://, or data:image/`,
        },
        { status: 400 },
      );
    }
    if (logo.length > MAX_LOGO_URL) {
      return NextResponse.json(
        {
          error: `Sponsor "${name}" logo is too big (${Math.round(logo.length / 1024)} KB) — keep originals under 1.5 MB.`,
        },
        { status: 413 },
      );
    }
    if (url && !/^https?:\/\//.test(url)) {
      return NextResponse.json(
        { error: `Sponsor "${name}" url must start with http:// or https://` },
        { status: 400 },
      );
    }
    cleaned.push({
      name,
      logo_url: logo,
      ...(url ? { url } : {}),
    });
  }

  const db = getAdminDb();
  await db
    .doc(`leagues/${leagueId}`)
    .set({ sponsors: cleaned }, { merge: true });

  await db.collection(`leagues/${leagueId}/audit`).add({
    kind: "sponsors_update",
    by_uid: decoded.uid,
    by_role: "admin",
    changes: { count: cleaned.length },
    at: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true, count: cleaned.length });
}

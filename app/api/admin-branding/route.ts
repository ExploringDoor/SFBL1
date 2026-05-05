// POST /api/admin-branding — admin updates the league's branding
// fields (name, abbrev, theme colors, logo URL).
//
// Why a dedicated endpoint vs a generic "update league config":
// branding is the field set that's safe to mutate from a UI form.
// The full LeagueConfig has stat-math fields (innings, ruleset,
// stat_columns) where a typo would silently break standings or
// recalc. Those stay editable only via `npm run provision` so a
// commissioner can't break them by accident.
//
// Body shape:
//   {
//     leagueId: string,
//     name?: string,
//     abbrev?: string,
//     theme?: {
//       primary?: string,    // hex, e.g. "#0c4a6e"
//       accent?: string,
//       secondary?: string,
//       logo_url?: string,
//     }
//   }
//
// Authority: caller must have `admin` claim on `leagueId`.
//
// Stamps `updated_at` + `updated_by_uid` on the league doc.

import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

interface Body {
  leagueId?: unknown;
  name?: unknown;
  abbrev?: unknown;
  theme?: unknown;
}

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

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
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

  // Validate + filter inputs. Anything not in this whitelist is dropped
  // — keeps the endpoint from being abused to write arbitrary fields.
  const update: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    if (body.name.length > 100) {
      return NextResponse.json(
        { error: "name too long (100 char max)" },
        { status: 400 },
      );
    }
    update.name = body.name.trim();
  }
  if (typeof body.abbrev === "string") {
    if (body.abbrev.length > 12) {
      return NextResponse.json(
        { error: "abbrev too long (12 char max)" },
        { status: 400 },
      );
    }
    update.abbrev = body.abbrev.trim().toUpperCase();
  }
  if (body.theme && typeof body.theme === "object") {
    const t = body.theme as Record<string, unknown>;
    const themePatch: Record<string, string> = {};
    for (const key of ["primary", "accent", "secondary"] as const) {
      if (typeof t[key] === "string" && t[key]) {
        if (!HEX_COLOR_RE.test(t[key] as string)) {
          return NextResponse.json(
            { error: `theme.${key} must be a hex color (e.g. "#0c4a6e")` },
            { status: 400 },
          );
        }
        themePatch[key] = t[key] as string;
      }
    }
    if (typeof t.logo_url === "string") {
      // Accept either an absolute URL (Firebase Storage), an absolute
      // path (/logos/sfbl/...), or empty (clear). Reject anything weird.
      const v = t.logo_url.trim();
      if (
        v === "" ||
        v.startsWith("/") ||
        v.startsWith("https://") ||
        v.startsWith("http://")
      ) {
        themePatch.logo_url = v;
      } else {
        return NextResponse.json(
          {
            error:
              "theme.logo_url must start with /, https://, or http:// (or be empty to clear)",
          },
          { status: 400 },
        );
      }
    }
    if (Object.keys(themePatch).length) {
      update.theme = themePatch;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "No branding fields to update" },
      { status: 400 },
    );
  }

  update.updated_at = new Date().toISOString();
  update.updated_by_uid = decoded.uid;

  const db = getAdminDb();
  // Merge so we don't clobber the rest of the LeagueConfig — only
  // the fields we explicitly pulled through.
  await db.doc(`leagues/${leagueId}`).set(update, { merge: true });

  return NextResponse.json({ ok: true, updated: Object.keys(update) });
}

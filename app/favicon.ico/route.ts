// Root-level icon, served per tenant.
//
// iOS looks for a home-screen icon in the <link rel="apple-touch-icon"> tag
// and, failing that, at these root paths. The link tag is correct, but the
// root paths 404'd — and when iOS cannot resolve an icon it falls back to a
// generated letter tile. That is the black "C" Adam got.
//
// Two things this has to work around:
//
//  1. Every league shares this codebase, so a static file in public/ would
//     hand COYBL's badge to SFBL and Island. Hence a route.
//
//  2. middleware.ts EXCLUDES paths ending .png/.ico from its matcher, so
//     x-tenant-id is never injected here. The tenant is parsed from the Host
//     header instead — parseHost already resolves custom domains and aliases,
//     and needs no Firestore read.

import { NextResponse } from "next/server";

import { parseHost } from "@/lib/tenants";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("host") ?? url.host;
  const slug = parseHost(host).slug;
  if (!slug) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(`${url.origin}/${slug}/favicon-32.png`, 307);
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseHost, resolveTenant, toPublicConfig } from "./lib/tenants";

// Cookie + query-param name for the tenant-override preview flow.
// Letting a developer/admin point at a staging tenant from a
// production hostname without having to set up DNS first. Visit
// `?_tenant=lbdc-staging` once → cookie persists the override for
// 4 hours so subsequent in-app navigation stays on the previewed
// tenant. Visit `?_tenant=` (empty) to clear.
//
// Safety: the override only works if the target tenant exists in
// Firestore (resolveTenant returns null otherwise), so an attacker
// can't preview a tenant that hasn't been seeded. The cookie has
// no security implications — it just selects which league's public
// data the renderer shows.
const PREVIEW_COOKIE = "le_preview_tenant";
const PREVIEW_SLUG_RE = /^[a-z][a-z0-9-]+$/;
const PREVIEW_TTL_SECONDS = 4 * 60 * 60;

export async function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const parsed = parseHost(host);

  console.log(
    `[middleware v3] host=${host} kind=${parsed.kind} slug=${parsed.slug ?? "-"} path=${req.nextUrl.pathname}`,
  );

  // ── tenant preview override ──────────────────────────────────────
  const previewQuery = req.nextUrl.searchParams.get("_tenant");
  const previewCookie = req.cookies.get(PREVIEW_COOKIE)?.value ?? null;
  // Empty query param clears the cookie; non-empty value (or any
  // already-set cookie) selects an override tenant.
  const clearPreview = previewQuery === "";
  const overrideSlug = clearPreview
    ? null
    : previewQuery && PREVIEW_SLUG_RE.test(previewQuery)
      ? previewQuery
      : previewCookie && PREVIEW_SLUG_RE.test(previewCookie)
        ? previewCookie
        : null;

  if (overrideSlug) {
    const overrideTenant = await resolveTenant({
      kind: "subdomain",
      hostname: parsed.hostname,
      slug: overrideSlug,
    });
    if (overrideTenant) {
      const headers = new Headers(req.headers);
      headers.set("x-tenant-host", parsed.hostname);
      headers.set("x-tenant-id", overrideTenant.id);
      headers.set(
        "x-tenant-config-json",
        JSON.stringify(toPublicConfig(overrideTenant.config)),
      );
      const res = NextResponse.next({ request: { headers } });
      // Persist (or refresh) the cookie when a query param triggered
      // this override. Cookie is rolling-TTL: every request renews.
      if (previewQuery && previewQuery === overrideSlug) {
        res.cookies.set({
          name: PREVIEW_COOKIE,
          value: overrideSlug,
          maxAge: PREVIEW_TTL_SECONDS,
          path: "/",
          sameSite: "lax",
        });
      }
      return res;
    }
    // Override slug didn't resolve — fall through to normal handling
    // so the user at least sees the right tenant for the hostname.
  }

  // Bare apex (`localhost`, `leagueengine.com`) — no tenant, render landing.
  if (parsed.kind === "apex") {
    const headers = new Headers(req.headers);
    headers.set("x-tenant-host", parsed.hostname);
    const res = NextResponse.next({ request: { headers } });
    if (clearPreview) res.cookies.delete(PREVIEW_COOKIE);
    return res;
  }

  let tenant: Awaited<ReturnType<typeof resolveTenant>> = null;
  try {
    tenant = await resolveTenant(parsed);
  } catch (err) {
    console.error("[middleware] resolveTenant threw:", err);
  }

  if (!tenant) {
    return new NextResponse(
      `Tenant not found for host: ${parsed.hostname} (kind=${parsed.kind} slug=${parsed.slug ?? "-"})\n`,
      { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-tenant-host", parsed.hostname);
  requestHeaders.set("x-tenant-id", tenant.id);
  // Strip freeform/PII fields (billing.notes, payment dates) before they
  // ride along on every request header. Server components needing full
  // billing detail should re-fetch /leagues/{id} directly.
  requestHeaders.set("x-tenant-config-json", JSON.stringify(toPublicConfig(tenant.config)));

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  if (clearPreview) res.cookies.delete(PREVIEW_COOKIE);
  return res;
}

export const config = {
  matcher: [
    // Exclude:
    //   - /api/*  — API routes do their own bearer-token / claim auth.
    //               Letting middleware run on them is wasteful (extra
    //               Firestore lookup per call) AND dangerous: when
    //               server-fanout fetches /api/send-notification with
    //               an inferred origin that doesn't match any tenant
    //               (e.g. a *.vercel.app preview URL leaking through),
    //               middleware would 404 the API call and silently
    //               break push delivery.
    //   - /_next/static, /_next/image, favicon, common static files.
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|txt|xml)).*)",
  ],
};

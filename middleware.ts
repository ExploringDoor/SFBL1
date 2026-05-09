import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseHost, resolveTenant, toPublicConfig } from "./lib/tenants";

export async function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const parsed = parseHost(host);

  console.log(
    `[middleware v3] host=${host} kind=${parsed.kind} slug=${parsed.slug ?? "-"} path=${req.nextUrl.pathname}`,
  );

  // Bare apex (`localhost`, `leagueengine.com`) — no tenant, render landing.
  if (parsed.kind === "apex") {
    const headers = new Headers(req.headers);
    headers.set("x-tenant-host", parsed.hostname);
    return NextResponse.next({ request: { headers } });
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

  return NextResponse.next({ request: { headers: requestHeaders } });
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

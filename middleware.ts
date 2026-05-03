import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseHost, resolveTenant, toPublicConfig } from "./lib/tenants";

export async function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const parsed = parseHost(host);

  console.log(
    `[middleware] host=${host} kind=${parsed.kind} slug=${parsed.slug ?? "-"} path=${req.nextUrl.pathname}`,
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
      `Tenant not found for host: ${parsed.hostname}\n`,
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
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|txt|xml)).*)",
  ],
};

// Per-tenant robots.txt. Each league gets indexed independently
// based on the host header. Admin / captain / api paths are
// disallowed since they require auth and have no value to surface
// in search.

import { headers } from "next/headers";
import { parseHost, resolveTenant } from "@/lib/tenants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const h = headers();
  const host =
    h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";

  // Resolve tenant — if not a tenant host (e.g. apex landing), block
  // indexing entirely. Tenant subdomains/custom domains get a
  // permissive robots policy with the sitemap pointer.
  const tenant = await resolveTenant(parseHost(host));
  if (!tenant) {
    return new Response("User-agent: *\nDisallow: /\n", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const sitemapUrl = `${proto}://${host}/sitemap.xml`;
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /admin/",
    "Disallow: /captain",
    "Disallow: /captain/",
    "Disallow: /profile",
    "Disallow: /api/",
    "Disallow: /print/",
    "Disallow: /_platform",
    "Disallow: /login",
    "",
    `Sitemap: ${sitemapUrl}`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

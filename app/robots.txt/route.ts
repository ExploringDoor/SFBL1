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
    // TRAILING SLASH REQUIRED. Robots matching is a prefix match, so a bare
    // "Disallow: /pay" would also block /pay-online, which is a real public page
    // (app/pay-online) that LBDC and SFBL rely on being found. This blocks
    // /pay/{id} only. Those pages carry a name and an amount and there is a
    // Firestore read behind each one, so neither indexing nor crawling them is
    // wanted.
    "Disallow: /pay/",
    "Disallow: /print/",
    "Disallow: /_platform",
    "Disallow: /login",
    // Under review by the league office and not linked from anywhere. The
    // pages also carry robots:noindex; this keeps them out of a crawl that
    // never reads the page. Remove both when Doug signs them off.
    "Disallow: /tournament-registration",
    "Disallow: /baseball-order",
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

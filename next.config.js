/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // No HSTS here: Vercel already sends it, and includeSubDomains is
          // risky while league custom domains (sfbl.com etc.) may have
          // non-Vercel subdomains.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // SAMEORIGIN not DENY: cheap insurance for any self-embedding,
          // still blocks cross-origin clickjacking.
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        source: '/logos/:path*',
        headers: [
          // NOT immutable: logos get overwritten in place under the same
          // filename (e.g. sf-angels.png).
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
      {
        source: '/og-default.jpg',
        headers: [
          // Same policy as /logos: the fallback OG image can be
          // overwritten in place, so cache but allow revalidation.
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;

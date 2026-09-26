// SSRF guards for the Arbiter iCal feed fetch.
//
// The feed URL is admin-supplied and re-fetched unattended by the cron, so it is
// an SSRF surface. Two layers:
//   1. A host allowlist — the feed can only be an ArbiterSports host. This is the
//      primary defense: it rejects raw-IP hosts and internal names outright, and
//      because an attacker can't control arbitersports.com DNS it also closes the
//      DNS-rebinding window that a bare private-IP check leaves open.
//   2. A private-IP block as defense in depth, for every resolved address and
//      every redirect hop, in case the allowlist is ever widened.
//
// Pure and dependency-free so it can be unit-tested without the route's Firestore
// and node:dns imports.

/** ArbiterSports feed hosts. Extend if a real feed is served from another host. */
export const FEED_HOST_ALLOWLIST = ["arbitersports.com"];

export function isAllowedFeedHost(host: string): boolean {
  const h = String(host ?? "").toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  return FEED_HOST_ALLOWLIST.some((d) => h === d || h.endsWith("." + d));
}

export function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/** True for loopback / private / link-local / reserved addresses that a public
 *  feed must never resolve to. Handles IPv4, IPv6, and BOTH textual forms of an
 *  IPv4-mapped IPv6 address (::ffff:127.0.0.1 and its hex form ::ffff:7f00:1,
 *  which is how new URL() normalizes a bracketed literal). */
export function isPrivateIp(raw: string): boolean {
  let ip = String(raw ?? "").toLowerCase().replace(/^\[|\]$/g, "");

  // IPv4-mapped IPv6, dotted form: ::ffff:127.0.0.1
  const mappedDotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mappedDotted) ip = mappedDotted[1]!;

  // IPv4-mapped IPv6, hex form: ::ffff:7f00:1  (and ::ffff:a9fe:a9fe)
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1]!, 16);
    const lo = parseInt(mappedHex[2]!, 16);
    ip = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const p = ip.split(".").map(Number);
    if (p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed = block
    const [a, b] = p as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true; // 192.0.0.0/24, 192.0.2.0/24
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  // IPv6
  if (ip === "::1" || ip === "::") return true;
  if (ip.startsWith("fe80")) return true; // link-local
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // unique-local fc00::/7
  // An unrecognized IPv6 form (incl. any other ::ffff / :: embedded) is treated
  // conservatively as non-public only when clearly mapped; otherwise allow the
  // allowlist + resolved-IP checks to decide. A bare "::" style is caught above.
  return false;
}

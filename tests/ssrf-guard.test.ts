import { describe, it, expect } from "vitest";
import { isPrivateIp, isAllowedFeedHost, isIpLiteral } from "@/lib/ssrf-guard";

describe("isPrivateIp — IPv4", () => {
  it("blocks loopback, RFC1918, CGNAT, link-local/metadata", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.1.1", "100.64.0.1", "169.254.169.254", "0.0.0.0", "224.0.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "23.45.67.89"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
  it("blocks malformed octets", () => {
    expect(isPrivateIp("999.1.1.1")).toBe(true);
  });
});

describe("isPrivateIp — IPv6 and IPv4-mapped (the bypass the audit found)", () => {
  it("blocks loopback and unique/link-local IPv6", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it("blocks IPv4-mapped IPv6 in BOTH dotted and hex forms", () => {
    // Dotted form
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true);
    // Hex form — how new URL() normalizes a bracketed literal (the bypass)
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true); // 127.0.0.1
    expect(isPrivateIp("::ffff:a9fe:a9fe")).toBe(true); // 169.254.169.254
    expect(isPrivateIp("::ffff:0a00:0001")).toBe(true); // 10.0.0.1
  });
  it("does not block a mapped PUBLIC address", () => {
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
    expect(isPrivateIp("::ffff:0808:0808")).toBe(false); // 8.8.8.8
  });
});

describe("isAllowedFeedHost", () => {
  it("allows arbitersports.com and subdomains", () => {
    for (const h of ["arbitersports.com", "feeds.arbitersports.com", "messaging.arbitersports.com", "ARBITERSPORTS.COM", "a.b.arbitersports.com"]) {
      expect(isAllowedFeedHost(h), h).toBe(true);
    }
  });
  it("rejects look-alikes, raw IPs, and internal hosts", () => {
    for (const h of ["arbitersports.com.evil.test", "notarbitersports.com", "169.254.169.254", "localhost", "metadata.google.internal", "evil.test"]) {
      expect(isAllowedFeedHost(h), h).toBe(false);
    }
  });
});

describe("isIpLiteral", () => {
  it("recognizes IPv4 and IPv6 literals", () => {
    expect(isIpLiteral("10.0.0.1")).toBe(true);
    expect(isIpLiteral("::1")).toBe(true);
    expect(isIpLiteral("feeds.arbitersports.com")).toBe(false);
  });
});

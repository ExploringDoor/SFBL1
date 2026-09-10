// Flyers attached to a broadcast.
//
// The allowlist is the security boundary: this image is served from the
// league's own origin, so svg+xml would mean serving script from it.

import { describe, expect, it } from "vitest";
import { flyerUrl, isAllowedFlyerDataUrl, MAX_FLYER_BYTES } from "@/lib/flyer";

const jpeg = (n = 40) => `data:image/jpeg;base64,${"A".repeat(n)}`;

describe("isAllowedFlyerDataUrl", () => {
  it("accepts the formats a mail client renders", () => {
    for (const t of ["png", "jpeg", "webp", "gif"]) {
      expect(isAllowedFlyerDataUrl(`data:image/${t};base64,AAAA`)).toBe(true);
    }
  });

  it("REFUSES svg, which can carry script on our own origin", () => {
    expect(isAllowedFlyerDataUrl("data:image/svg+xml;base64,AAAA")).toBe(false);
  });

  it("refuses a PDF, which shows as a broken image in the body", () => {
    expect(isAllowedFlyerDataUrl("data:application/pdf;base64,AAAA")).toBe(false);
  });

  it("refuses anything that is not a data URL", () => {
    expect(isAllowedFlyerDataUrl("https://example.com/flyer.jpg")).toBe(false);
    expect(isAllowedFlyerDataUrl("javascript:alert(1)")).toBe(false);
  });

  it("refuses a non-string", () => {
    expect(isAllowedFlyerDataUrl(null)).toBe(false);
    expect(isAllowedFlyerDataUrl(undefined)).toBe(false);
    expect(isAllowedFlyerDataUrl(42)).toBe(false);
  });

  it("refuses anything over the document cap", () => {
    expect(isAllowedFlyerDataUrl(jpeg(MAX_FLYER_BYTES + 10))).toBe(false);
  });

  it("accepts one just under the cap", () => {
    expect(isAllowedFlyerDataUrl(jpeg(MAX_FLYER_BYTES - 100))).toBe(true);
  });
});

describe("flyerUrl", () => {
  it("is absolute, because it is read from an inbox", () => {
    expect(flyerUrl("https://www.islandfastpitch.com", "island", "abc123")).toBe(
      "https://www.islandfastpitch.com/api/broadcast-flyer/island/abc123",
    );
  });

  it("escapes ids rather than letting them shape the path", () => {
    expect(flyerUrl("https://x.test", "a/b", "c d")).toBe(
      "https://x.test/api/broadcast-flyer/a%2Fb/c%20d",
    );
  });
});

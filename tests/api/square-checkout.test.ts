// Exercises the real /api/square-checkout route handler against a stand-in
// Square API (fetch is stubbed) and a stand-in Firestore (firebase-admin is
// mocked). No credentials, no network, no real money — this proves the
// integration's logic: the 3.25% card surcharge, location auto-detection from
// the access token, the exact request sent to Square, sandbox/production host
// switching, and graceful fallback when nothing is configured.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mocks must be hoisted above the route import so it picks them up.
const { getMock, setMock, docMock } = vi.hoisted(() => {
  const getMock = vi.fn();
  const setMock = vi.fn();
  const docMock = vi.fn(() => ({ get: getMock, set: setMock }));
  return { getMock, setMock, docMock };
});

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: () => ({ doc: docMock }),
}));

import { POST } from "@/app/api/square-checkout/route";

const ACTIVE_LOC = { id: "LSANDBOX123", status: "ACTIVE" };

function req(body: unknown, tenant: string | null = "coybl") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (tenant) headers["x-tenant-id"] = tenant;
  return new Request("http://coybl.localhost/api/square-checkout", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function registration(fee: number, name = "Test Thunder") {
  getMock.mockResolvedValue({ exists: true, data: () => ({ fee, team: { name } }) });
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

// Stand-in Square: records every call, answers /v2/locations and the
// payment-links endpoint with canned success.
function stubSquare(opts: { locations?: unknown[]; url?: string } = {}): FetchCall[] {
  const calls: FetchCall[] = [];
  const spy = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes("/v2/locations")) {
      return new Response(JSON.stringify({ locations: opts.locations ?? [ACTIVE_LOC] }), {
        status: 200,
      });
    }
    if (u.includes("/v2/online-checkout/payment-links")) {
      return new Response(
        JSON.stringify({
          payment_link: { url: opts.url ?? "https://squareupsandbox.com/checkout/xyz" },
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", spy);
  return calls;
}

function paymentBody(calls: FetchCall[]) {
  const c = calls.find((x) => x.url.includes("/payment-links"));
  return c?.init?.body ? JSON.parse(String(c.init.body)) : null;
}

// Unique token per test so the route's per-token location cache never leaks
// a resolved location from one test into the next.
let tokenSeq = 0;

beforeEach(() => {
  getMock.mockReset();
  setMock.mockReset().mockResolvedValue(undefined);
  process.env.SQUARE_ACCESS_TOKEN = `sbxtoken${tokenSeq++}`;
  process.env.SQUARE_ENV = "sandbox";
  delete process.env.SQUARE_LOCATION_ID;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/square-checkout", () => {
  it("adds the 3.25% surcharge and returns the checkout link", async () => {
    registration(495); // with-insurance fee
    const calls = stubSquare({ url: "https://squareupsandbox.com/checkout/abc" });

    const res = await POST(req({ registrationId: "reg123" }));
    expect(res.status).toBe(200);

    const json = await res.json();
    // 495 * 1.0325 = 511.0875 -> 51109 cents
    expect(json.amount_cents).toBe(51109);
    expect(json.url).toBe("https://squareupsandbox.com/checkout/abc");

    const body = paymentBody(calls);
    expect(body.quick_pay.price_money.amount).toBe(51109);
    expect(body.quick_pay.price_money.currency).toBe("USD");
    expect(body.quick_pay.name).toContain("Test Thunder");
  });

  it("auto-detects the active location from the access token", async () => {
    registration(495);
    const calls = stubSquare();

    await POST(req({ registrationId: "reg123" }));

    expect(calls.some((c) => c.url.includes("/v2/locations"))).toBe(true);
    expect(paymentBody(calls).quick_pay.location_id).toBe("LSANDBOX123");
  });

  it("uses an explicit SQUARE_LOCATION_ID and skips the lookup", async () => {
    process.env.SQUARE_LOCATION_ID = "LEXPLICIT";
    registration(425);
    const calls = stubSquare();

    await POST(req({ registrationId: "reg123" }));

    expect(calls.some((c) => c.url.includes("/v2/locations"))).toBe(false);
    expect(paymentBody(calls).quick_pay.location_id).toBe("LEXPLICIT");
  });

  it("surcharges the without-insurance fee too (425 -> 43881)", async () => {
    registration(425);
    const calls = stubSquare();

    const res = await POST(req({ registrationId: "reg123" }));
    const json = await res.json();
    // 425 * 1.0325 = 438.8125 -> 43881 cents
    expect(json.amount_cents).toBe(43881);
    expect(paymentBody(calls).quick_pay.price_money.amount).toBe(43881);
  });

  it("targets the sandbox host when SQUARE_ENV=sandbox", async () => {
    registration(495);
    const calls = stubSquare();

    await POST(req({ registrationId: "reg123" }));

    expect(calls.every((c) => c.url.startsWith("https://connect.squareupsandbox.com"))).toBe(true);
  });

  it("targets the production host when SQUARE_ENV=production", async () => {
    process.env.SQUARE_ENV = "production";
    registration(495);
    const calls = stubSquare();

    await POST(req({ registrationId: "reg123" }));

    expect(calls.every((c) => c.url.startsWith("https://connect.squareup.com"))).toBe(true);
  });

  it("authorizes Square with the configured access token", async () => {
    const token = process.env.SQUARE_ACCESS_TOKEN!;
    registration(495);
    const calls = stubSquare();

    await POST(req({ registrationId: "reg123" }));

    const pay = calls.find((c) => c.url.includes("/payment-links"));
    const auth = (pay?.init?.headers as Record<string, string>)?.["Authorization"];
    expect(auth).toBe(`Bearer ${token}`);
  });

  it("falls back with 503 when no access token is configured", async () => {
    delete process.env.SQUARE_ACCESS_TOKEN;
    registration(495);

    const res = await POST(req({ registrationId: "reg123" }));
    expect(res.status).toBe(503);
  });

  it("rejects an unknown tenant", async () => {
    const res = await POST(req({ registrationId: "reg123" }, null));
    expect(res.status).toBe(400);
  });

  it("404s when the registration does not exist", async () => {
    getMock.mockResolvedValue({ exists: false });
    stubSquare();

    const res = await POST(req({ registrationId: "missing" }));
    expect(res.status).toBe(404);
  });

  it("rejects a zero/invalid registration amount", async () => {
    registration(0);
    stubSquare();

    const res = await POST(req({ registrationId: "reg123" }));
    expect(res.status).toBe(400);
  });
});

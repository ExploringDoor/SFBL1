// Regression tests for lib/notifications/server-fanout.ts → originFromRequest.
//
// Ship-blocker found 2026-05-04 by independent code review:
// `originFromRequest` was preferring `process.env.VERCEL_URL` over the
// caller's request URL. On Vercel, VERCEL_URL is set to the project's
// `*.vercel.app` hostname which is NOT in `LEAGUEENGINE_APEX_DOMAINS`.
// Middleware would tenant-resolve that host, find nothing, and return
// 404 — silently breaking every push fan-out (chat, scores, rainouts,
// schedule changes).
//
// Fix: prefer `req.url`'s origin (which is the actual public host the
// user hit, e.g. https://sfbl.leagueengine.com) and fall back to
// VERCEL_URL only if req.url is unparseable.
//
// These tests pin the new precedence so a future "improvement" can't
// reintroduce the bug.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { originFromRequest } from "@/lib/notifications/server-fanout";

const ORIGINAL_VERCEL_URL = process.env.VERCEL_URL;

beforeEach(() => {
  delete process.env.VERCEL_URL;
});

afterEach(() => {
  if (ORIGINAL_VERCEL_URL === undefined) {
    delete process.env.VERCEL_URL;
  } else {
    process.env.VERCEL_URL = ORIGINAL_VERCEL_URL;
  }
});

describe("originFromRequest — req.url is preferred", () => {
  it("uses the request URL's origin (the user-hit host)", () => {
    const req = new Request("https://sfbl.leagueengine.com/api/captain-submit");
    expect(originFromRequest(req)).toBe("https://sfbl.leagueengine.com");
  });

  it("uses request URL even when VERCEL_URL is set (the bug fix)", () => {
    // BEFORE THE FIX: this returned `https://league-platform-abc.vercel.app`,
    // which middleware would 404 since it's not in APEX_DOMAINS.
    process.env.VERCEL_URL = "league-platform-abc.vercel.app";
    const req = new Request("https://sfbl.leagueengine.com/api/captain-submit");
    expect(originFromRequest(req)).toBe("https://sfbl.leagueengine.com");
  });

  it("works for tenant subdomain", () => {
    const req = new Request("https://kcsl.leagueengine.com/api/recalc");
    expect(originFromRequest(req)).toBe("https://kcsl.leagueengine.com");
  });

  it("works for custom tenant domain", () => {
    const req = new Request("https://sfbl.com/api/chat-message");
    expect(originFromRequest(req)).toBe("https://sfbl.com");
  });

  it("works for localhost dev with subdomain + port", () => {
    const req = new Request("http://sfbl.localhost:3000/api/captain-submit");
    expect(originFromRequest(req)).toBe("http://sfbl.localhost:3000");
  });

  it("doesn't include the path or query in the origin", () => {
    const req = new Request(
      "https://sfbl.leagueengine.com/api/captain-submit?id=g1",
    );
    expect(originFromRequest(req)).toBe("https://sfbl.leagueengine.com");
  });
});

describe("originFromRequest — VERCEL_URL fallback", () => {
  it("falls back to VERCEL_URL only when request URL is unparseable", () => {
    process.env.VERCEL_URL = "league-platform-abc.vercel.app";
    // Force the URL constructor to throw by passing a Request whose
    // url is malformed. In practice this should never happen — the
    // Request constructor itself rejects malformed URLs — so this is
    // a belt-and-suspenders fallback.
    const fakeReq = { url: "" } as unknown as Request;
    expect(originFromRequest(fakeReq)).toBe(
      "https://league-platform-abc.vercel.app",
    );
  });

  it("falls back to localhost:3000 when neither url nor VERCEL_URL works", () => {
    delete process.env.VERCEL_URL;
    const fakeReq = { url: "" } as unknown as Request;
    expect(originFromRequest(fakeReq)).toBe("http://localhost:3000");
  });
});

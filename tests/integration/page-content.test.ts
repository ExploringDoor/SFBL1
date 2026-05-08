// Integration tests for /api/page-content.
//
// Admin-only: writes commissioner-edited markdown to
// /leagues/{leagueId}/page_content/{pageId}. Stores both the raw
// markdown and a sanitized HTML cache so server-rendered pages don't
// re-parse on every request.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = {
  decoded: {
    uid: "uid_admin",
    leagues: { sfbl: "admin" } as Record<string, string>,
  } as { uid: string; leagues?: Record<string, string> },
  setCalls: [] as Array<{
    path: string;
    data: Record<string, unknown>;
    merge: boolean;
  }>,
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => mockState.decoded),
  }),
  getAdminDb: () => ({
    doc: (path: string) => ({
      set: async (
        data: Record<string, unknown>,
        opts?: { merge?: boolean },
      ) => {
        mockState.setCalls.push({
          path,
          data,
          merge: opts?.merge === true,
        });
      },
    }),
  }),
  getAdminMessaging: () => ({}),
}));

const { POST } = await import("@/app/api/page-content/route");

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/page-content", {
    method: "POST",
    headers: {
      authorization: "Bearer fake",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockState.decoded = {
    uid: "uid_admin",
    leagues: { sfbl: "admin" },
  };
  mockState.setCalls = [];
});

afterEach(() => vi.clearAllMocks());

describe("/api/page-content — auth", () => {
  it("rejects callers without admin claim", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await POST(
      makeReq({ leagueId: "sfbl", pageId: "rules", markdown: "# Rules" }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects admin in different league", async () => {
    mockState.decoded.leagues = { kcsl: "admin" };
    const res = await POST(
      makeReq({ leagueId: "sfbl", pageId: "rules", markdown: "# Rules" }),
    );
    expect(res.status).toBe(403);
  });
});

describe("/api/page-content — body validation", () => {
  it("rejects missing leagueId", async () => {
    const res = await POST(
      makeReq({ pageId: "rules", markdown: "# X" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects malformed pageId (uppercase, slashes)", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        pageId: "Rules/Hidden",
        markdown: "# X",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("accepts pageId with hyphens + underscores", async () => {
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        pageId: "code-of-conduct",
        markdown: "# Code",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("rejects markdown that's not a string", async () => {
    const res = await POST(
      makeReq({ leagueId: "sfbl", pageId: "rules", markdown: 42 }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects payload over the 500KB cap", async () => {
    // Cap was bumped from 200K to 500K when html-source path was
    // added (RichEditor with embedded data-URL images is bigger
    // than markdown for the same content).
    const huge = "x".repeat(500_001);
    const res = await POST(
      makeReq({ leagueId: "sfbl", pageId: "rules", markdown: huge }),
    );
    expect(res.status).toBe(413);
  });
});

describe("/api/page-content — write", () => {
  it("writes markdown + sanitized html + updated_at + updated_by", async () => {
    const md = "# Rules\n\nRule one: **always slide.**";
    const res = await POST(
      makeReq({ leagueId: "sfbl", pageId: "rules", markdown: md }),
    );
    expect(res.status).toBe(200);
    expect(mockState.setCalls).toHaveLength(1);
    expect(mockState.setCalls[0]!.path).toBe(
      "leagues/sfbl/page_content/rules",
    );
    expect(mockState.setCalls[0]!.merge).toBe(true);
    const data = mockState.setCalls[0]!.data;
    expect(data.markdown).toBe(md);
    expect(typeof data.html).toBe("string");
    expect(data.html).toContain("<h1");
    expect(data.html).toContain("<strong>");
    expect(data.updated_by).toBe("uid_admin");
    expect(data.updated_at).toBeTruthy();
  });

  it("strips dangerous HTML on save (XSS guard)", async () => {
    const malicious =
      "# Hi\n\n<script>alert('xss')</script>\n\n<img src=x onerror=alert(1)>";
    const res = await POST(
      makeReq({
        leagueId: "sfbl",
        pageId: "rules",
        markdown: malicious,
      }),
    );
    expect(res.status).toBe(200);
    const html = String(mockState.setCalls[0]!.data.html);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });
});

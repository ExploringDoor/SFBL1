// Integration tests for /api/chat-message-delete and /api/chat-reset.
// These are the moderation paths for chat — single-message delete and
// nuke-the-thread reset.
//
// Authority matrix (matches DVSL captain.html):
//   chat-message-delete:
//     - self-delete (matched by uid OR email): always allowed
//     - team_messages moderate: captain of msg.team_id, or admin
//     - captain_chat moderate: author only (admin gets a platform
//       override for moderation, documented in route)
//   chat-reset:
//     - team_messages: captain of teamId, or admin
//     - captain_chat: admin only (shared room — no captain owns it)
//
// chat-reset also batches deletes in chunks of 400 to stay under
// Firestore's 500-op writeBatch cap. We verify both: it works for
// small thread counts AND it batches correctly past 400.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface DocState {
  data: Record<string, unknown>;
}

const mockState = {
  decoded: {
    uid: "uid_caller",
    email: "caller@example.com",
    leagues: { sfbl: "captain:team_a" } as Record<string, string>,
  } as {
    uid: string;
    email?: string;
    leagues?: Record<string, string>;
  },
  // Firestore docs keyed by full path.
  docs: new Map<string, DocState>(),
  // Captured deletes (single-doc).
  deletes: [] as string[],
  // Captured batch operations.
  batchDeletes: [] as string[],
  batchCommits: 0,
  // Failure toggles.
  verifyThrows: false,
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => {
      if (mockState.verifyThrows) throw new Error("token expired");
      return mockState.decoded;
    }),
  }),
  getAdminDb: () => {
    const docFor = (path: string) => ({
      ref: { path },
      id: path.split("/").pop()!,
      get: async () => {
        const ds = mockState.docs.get(path);
        return {
          exists: ds != null,
          data: () => ds?.data ?? {},
        };
      },
      delete: async () => {
        mockState.deletes.push(path);
        mockState.docs.delete(path);
      },
    });
    return {
      doc: (path: string) => docFor(path),
      collection: (collPath: string) => {
        const filterChain = (filters: Array<[string, string, unknown]>) => {
          return {
            where: (f: string, op: string, v: unknown) =>
              filterChain([...filters, [f, op, v]]),
            get: async () => {
              const matched: Array<{
                id: string;
                ref: { path: string };
                data: () => Record<string, unknown>;
              }> = [];
              for (const [docPath, state] of mockState.docs) {
                if (
                  docPath.startsWith(collPath + "/") &&
                  !docPath.slice(collPath.length + 1).includes("/")
                ) {
                  const passes = filters.every(([field, op, value]) =>
                    op === "==" ? state.data[field] === value : true,
                  );
                  if (passes) {
                    const id = docPath.slice(collPath.length + 1);
                    matched.push({
                      id,
                      ref: { path: docPath },
                      data: () => state.data,
                    });
                  }
                }
              }
              return {
                empty: matched.length === 0,
                docs: matched,
              };
            },
          };
        };
        return filterChain([]);
      },
      batch: () => {
        const ops: string[] = [];
        return {
          delete: (ref: { path: string }) => {
            ops.push(ref.path);
          },
          commit: async () => {
            mockState.batchCommits += 1;
            for (const path of ops) {
              mockState.batchDeletes.push(path);
              mockState.docs.delete(path);
            }
          },
        };
      },
    };
  },
  getAdminMessaging: () => ({}),
}));

const { POST: deletePost } = await import(
  "@/app/api/chat-message-delete/route"
);
const { POST: resetPost } = await import("@/app/api/chat-reset/route");

function makeReq(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      authorization: "Bearer fake",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function setDoc(path: string, data: Record<string, unknown>) {
  mockState.docs.set(path, { data });
}

beforeEach(() => {
  mockState.decoded = {
    uid: "uid_caller",
    email: "caller@example.com",
    leagues: { sfbl: "captain:team_a" },
  };
  mockState.docs = new Map();
  mockState.deletes = [];
  mockState.batchDeletes = [];
  mockState.batchCommits = 0;
  mockState.verifyThrows = false;
});

afterEach(() => vi.clearAllMocks());

// ── chat-message-delete ──────────────────────────────────────────

describe("/api/chat-message-delete — auth + body", () => {
  it("401 missing bearer", async () => {
    const req = new Request("http://test/api/chat-message-delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        leagueId: "sfbl",
        collection: "team_messages",
        msgId: "m1",
      }),
    });
    expect((await deletePost(req)).status).toBe(401);
  });

  it("401 expired token", async () => {
    mockState.verifyThrows = true;
    const res = await deletePost(
      makeReq("http://test/api/chat-message-delete", {
        leagueId: "sfbl",
        collection: "team_messages",
        msgId: "m1",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("400 invalid collection", async () => {
    const res = await deletePost(
      makeReq("http://test/api/chat-message-delete", {
        leagueId: "sfbl",
        collection: "elsewhere",
        msgId: "m1",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400 missing msgId", async () => {
    const res = await deletePost(
      makeReq("http://test/api/chat-message-delete", {
        leagueId: "sfbl",
        collection: "team_messages",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("404 when message doesn't exist", async () => {
    const res = await deletePost(
      makeReq("http://test/api/chat-message-delete", {
        leagueId: "sfbl",
        collection: "team_messages",
        msgId: "ghost",
      }),
    );
    expect(res.status).toBe(404);
    expect(mockState.deletes).toHaveLength(0);
  });
});

describe("/api/chat-message-delete — self-delete", () => {
  it("user can always delete their own message (matched by uid)", async () => {
    setDoc("leagues/sfbl/team_messages/m1", {
      author_uid: "uid_caller",
      author_email: "someone-else@example.com",
      team_id: "team_b", // even on a different team
      text: "self message",
    });
    mockState.decoded.leagues = { sfbl: "player:p1" }; // not captain, not admin
    const res = await deletePost(
      makeReq("http://test/api/chat-message-delete", {
        leagueId: "sfbl",
        collection: "team_messages",
        msgId: "m1",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockState.deletes).toContain("leagues/sfbl/team_messages/m1");
  });

  it("user can self-delete via email match (case-insensitive)", async () => {
    setDoc("leagues/sfbl/team_messages/m1", {
      author_uid: "uid_OLD", // different uid
      author_email: "CALLER@example.com", // uppercase
      team_id: "team_a",
    });
    mockState.decoded = {
      uid: "uid_caller",
      email: "caller@example.com",
      leagues: { sfbl: "player:p1" },
    };
    const res = await deletePost(
      makeReq("http://test/api/chat-message-delete", {
        leagueId: "sfbl",
        collection: "team_messages",
        msgId: "m1",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("self-delete works in captain_chat too (author-only allowed)", async () => {
    setDoc("leagues/sfbl/captain_chat/m2", {
      author_uid: "uid_caller",
      author_email: "caller@example.com",
    });
    const res = await deletePost(
      makeReq("http://test/api/chat-message-delete", {
        leagueId: "sfbl",
        collection: "captain_chat",
        msgId: "m2",
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("/api/chat-message-delete — moderation", () => {
  it("captain of team_a CAN delete a message in team_a chat", async () => {
    setDoc("leagues/sfbl/team_messages/m1", {
      author_uid: "uid_someone_else",
      author_email: "player@example.com",
      team_id: "team_a",
    });
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await deletePost(
      makeReq("http://test/api/chat-message-delete", {
        leagueId: "sfbl",
        collection: "team_messages",
        msgId: "m1",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("captain of team_a CANNOT delete a message in team_b chat", async () => {
    setDoc("leagues/sfbl/team_messages/m1", {
      author_uid: "uid_someone_else",
      team_id: "team_b",
    });
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await deletePost(
      makeReq("http://test/api/chat-message-delete", {
        leagueId: "sfbl",
        collection: "team_messages",
        msgId: "m1",
      }),
    );
    expect(res.status).toBe(403);
    expect(mockState.deletes).toHaveLength(0);
  });

  it("admin can moderate any team_messages message", async () => {
    setDoc("leagues/sfbl/team_messages/m1", {
      author_uid: "uid_someone_else",
      team_id: "team_x",
    });
    mockState.decoded.leagues = { sfbl: "admin" };
    const res = await deletePost(
      makeReq("http://test/api/chat-message-delete", {
        leagueId: "sfbl",
        collection: "team_messages",
        msgId: "m1",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("captain CANNOT delete OTHER captain's message in captain_chat", async () => {
    // Per route comment: captain_chat is author-only delete; captains
    // can't moderate each other.
    setDoc("leagues/sfbl/captain_chat/m1", {
      author_uid: "uid_other_captain",
      author_email: "other@example.com",
    });
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await deletePost(
      makeReq("http://test/api/chat-message-delete", {
        leagueId: "sfbl",
        collection: "captain_chat",
        msgId: "m1",
      }),
    );
    expect(res.status).toBe(403);
    expect(mockState.deletes).toHaveLength(0);
  });

  it("admin CAN delete other captain's captain_chat message (platform override)", async () => {
    setDoc("leagues/sfbl/captain_chat/m1", {
      author_uid: "uid_other_captain",
    });
    mockState.decoded.leagues = { sfbl: "admin" };
    const res = await deletePost(
      makeReq("http://test/api/chat-message-delete", {
        leagueId: "sfbl",
        collection: "captain_chat",
        msgId: "m1",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("non-captain non-author CANNOT delete in team_messages", async () => {
    setDoc("leagues/sfbl/team_messages/m1", {
      author_uid: "uid_other",
      team_id: "team_a",
    });
    mockState.decoded.leagues = { sfbl: "player:p1" };
    const res = await deletePost(
      makeReq("http://test/api/chat-message-delete", {
        leagueId: "sfbl",
        collection: "team_messages",
        msgId: "m1",
      }),
    );
    expect(res.status).toBe(403);
  });
});

// ── chat-reset ───────────────────────────────────────────────────

describe("/api/chat-reset — auth + body", () => {
  it("401 missing bearer", async () => {
    const req = new Request("http://test/api/chat-reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
      }),
    });
    expect((await resetPost(req)).status).toBe(401);
  });

  it("400 invalid collection", async () => {
    const res = await resetPost(
      makeReq("http://test/api/chat-reset", {
        leagueId: "sfbl",
        collection: "global",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400 team_messages without teamId", async () => {
    const res = await resetPost(
      makeReq("http://test/api/chat-reset", {
        leagueId: "sfbl",
        collection: "team_messages",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/chat-reset — authority", () => {
  it("captain of team_a CAN reset their own team_messages", async () => {
    setDoc("leagues/sfbl/team_messages/m1", { team_id: "team_a", text: "x" });
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await resetPost(
      makeReq("http://test/api/chat-reset", {
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("captain of team_a CANNOT reset team_b's team_messages", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await resetPost(
      makeReq("http://test/api/chat-reset", {
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_b",
      }),
    );
    expect(res.status).toBe(403);
    expect(mockState.batchDeletes).toHaveLength(0);
  });

  it("admin can reset any team_messages", async () => {
    setDoc("leagues/sfbl/team_messages/m1", { team_id: "team_b" });
    mockState.decoded.leagues = { sfbl: "admin" };
    const res = await resetPost(
      makeReq("http://test/api/chat-reset", {
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_b",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("captain CANNOT reset captain_chat (admin-only)", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await resetPost(
      makeReq("http://test/api/chat-reset", {
        leagueId: "sfbl",
        collection: "captain_chat",
      }),
    );
    expect(res.status).toBe(403);
    expect(mockState.batchDeletes).toHaveLength(0);
  });

  it("admin CAN reset captain_chat", async () => {
    setDoc("leagues/sfbl/captain_chat/m1", {});
    mockState.decoded.leagues = { sfbl: "admin" };
    const res = await resetPost(
      makeReq("http://test/api/chat-reset", {
        leagueId: "sfbl",
        collection: "captain_chat",
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("/api/chat-reset — delete behavior", () => {
  it("returns deleted:0 when collection is empty (no batch fired)", async () => {
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await resetPost(
      makeReq("http://test/api/chat-reset", {
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
      }),
    );
    const data = (await res.json()) as { deleted: number };
    expect(data.deleted).toBe(0);
    expect(mockState.batchCommits).toBe(0);
  });

  it("only deletes messages on the captain's team (not other teams)", async () => {
    setDoc("leagues/sfbl/team_messages/m1", { team_id: "team_a" });
    setDoc("leagues/sfbl/team_messages/m2", { team_id: "team_a" });
    setDoc("leagues/sfbl/team_messages/m3", { team_id: "team_b" }); // different team
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    await resetPost(
      makeReq("http://test/api/chat-reset", {
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
      }),
    );
    // m3 must survive.
    expect(mockState.batchDeletes).toContain("leagues/sfbl/team_messages/m1");
    expect(mockState.batchDeletes).toContain("leagues/sfbl/team_messages/m2");
    expect(mockState.batchDeletes).not.toContain(
      "leagues/sfbl/team_messages/m3",
    );
    expect(mockState.docs.has("leagues/sfbl/team_messages/m3")).toBe(true);
  });

  it("batches deletes in chunks of 400 (under the 500-op writeBatch cap)", async () => {
    // Seed 850 messages on team_a.
    for (let i = 0; i < 850; i++) {
      setDoc(`leagues/sfbl/team_messages/m${i}`, { team_id: "team_a" });
    }
    mockState.decoded.leagues = { sfbl: "captain:team_a" };
    const res = await resetPost(
      makeReq("http://test/api/chat-reset", {
        leagueId: "sfbl",
        collection: "team_messages",
        teamId: "team_a",
      }),
    );
    const data = (await res.json()) as { deleted: number };
    expect(data.deleted).toBe(850);
    // 850 / 400 = 3 batches (400 + 400 + 50).
    expect(mockState.batchCommits).toBe(3);
    expect(mockState.batchDeletes).toHaveLength(850);
  });
});

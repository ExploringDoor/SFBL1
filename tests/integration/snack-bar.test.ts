// Integration tests for /api/snack-bar — the volunteer / game-day jobs board.
//
// What these pin, in order of how badly it would hurt to get wrong:
//   1. list_claims is the ONLY way contact details come out, and only the
//      "volunteers" scope can call it (public: 403; other scoped roles: 403)
//   2. generate_from_schedule is a MERGE: run it twice and the board does not
//      double, and an admin's edits + parents' sign-ups on an existing shift
//      survive the second run
//   3. every admin action refuses a caller without the scope, cross-tenant
//      included, with zero writes
//   4. a shift saved without a job is a snack-bar shift (LCYBL unchanged)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── A tiny in-memory Firestore ─────────────────────────────────────────

const store = new Map<string, Record<string, unknown>>();
let autoId = 0;
const state = { decoded: null as Record<string, unknown> | null, sets: 0 };

type Filter = { field: string; op: string; val: unknown };

function docRef(path: string) {
  const id = path.split("/").pop()!;
  const ref = {
    id,
    path,
    async get() {
      const d = store.get(path);
      return { id, exists: d !== undefined, data: () => d, ref };
    },
    async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
      state.sets += 1;
      store.set(path, opts?.merge ? { ...(store.get(path) ?? {}), ...data } : { ...data });
    },
    async update(data: Record<string, unknown>) {
      state.sets += 1;
      store.set(path, { ...(store.get(path) ?? {}), ...data });
    },
    async delete() {
      state.sets += 1;
      store.delete(path);
    },
  };
  return ref;
}

function matches(d: Record<string, unknown>, f: Filter): boolean {
  const v = d[f.field];
  if (f.op === ">=") return String(v) >= String(f.val);
  if (f.op === "<=") return String(v) <= String(f.val);
  if (f.op === "in") return Array.isArray(f.val) && f.val.includes(v);
  throw new Error(`mock: unsupported op ${f.op}`);
}

function collectionRef(path: string) {
  const filters: Filter[] = [];
  const q = {
    doc: (id?: string) => docRef(`${path}/${id ?? `auto${++autoId}`}`),
    where(field: string, op: string, val: unknown) {
      filters.push({ field, op, val });
      return q;
    },
    async get() {
      const docs = [...store.entries()]
        .filter(([p]) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes("/"))
        .map(([p, d]) => ({ id: p.split("/").pop()!, exists: true, data: () => d, ref: docRef(p) }))
        .filter((s) => filters.every((f) => matches(s.data(), f)));
      return { docs, size: docs.length, forEach: (fn: (d: (typeof docs)[number]) => void) => docs.forEach(fn) };
    },
    async add(data: Record<string, unknown>) {
      const id = `auto${++autoId}`;
      store.set(`${path}/${id}`, data);
      return { id };
    },
  };
  return q;
}

const db = {
  doc: docRef,
  collection: collectionRef,
  batch() {
    const ops: Array<() => Promise<void>> = [];
    return {
      set(ref: ReturnType<typeof docRef>, data: Record<string, unknown>, opts?: { merge?: boolean }) {
        ops.push(() => ref.set(data, opts));
      },
      async commit() {
        for (const op of ops) await op();
      },
    };
  },
  async runTransaction(fn: (tx: unknown) => Promise<void>) {
    const tx = {
      get: (ref: ReturnType<typeof docRef>) => ref.get(),
      update: (ref: ReturnType<typeof docRef>, data: Record<string, unknown>) => ref.update(data),
    };
    await fn(tx);
  },
};

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => {
      if (!state.decoded) throw new Error("no token");
      return state.decoded;
    }),
  }),
  getAdminDb: () => db,
}));

const { POST } = await import("@/app/api/snack-bar/route");

// ── Fixtures ────────────────────────────────────────────────────────────

const L = "etbl";
const ADMIN = { uid: "public-admin:etbl", leagues: { etbl: "admin" } };
const MINEOLA = {
  uid: "public-admin:etbl:mineola",
  leagues: { etbl: "admin:mineola" },
  admin_role: "mineola",
  admin_scopes: ["scores", "volunteers"],
  admin_town: "Mineola",
};
const UMPIRE = {
  uid: "public-admin:etbl:umpires",
  leagues: { etbl: "admin:umpires" },
  admin_role: "umpires",
  admin_scopes: ["umpires"],
};
const CAPTAIN = { uid: "cap", leagues: { etbl: "captain:t_a" } };
const OTHER_LEAGUE_ADMIN = { uid: "public-admin:island", leagues: { island: "admin" } };

// The public actions are rate-limited per IP (module-level). Every request in
// this file gets its own address unless a test asks for a fixed one.
let ipCounter = 0;
function req(body: Record<string, unknown>, auth = true, ip?: string): Request {
  ipCounter += 1;
  return new Request("http://test/api/snack-bar", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip ?? `198.51.100.${(ipCounter % 250) + 1}, 10.0.0.${Math.floor(ipCounter / 250)}`,
      ...(auth ? { authorization: "Bearer fake" } : {}),
    },
    body: JSON.stringify({ leagueId: L, ...body }),
  });
}

const THREE_JOBS = [
  { job: "Clock", slots: 1 },
  { job: "Scorebook", slots: 1 },
  { job: "Snack Bar", slots: 2 },
];

function seedSchedule() {
  store.set(`leagues/${L}/teams/t_a`, { name: "Mineola 3B Red" });
  store.set(`leagues/${L}/teams/t_b`, { name: "Quitman 3B Blue" });
  store.set(`leagues/${L}/games/g1`, {
    date: "2026-09-12",
    time: "09:00",
    field: "Mineola Community Gym",
    away_team_id: "t_a",
    home_team_id: "t_b",
    division: "3rd Grade Boys",
    status: "scheduled",
  });
  // Combined ISO date, the shape the provision script writes.
  store.set(`leagues/${L}/games/g2`, {
    date: "2026-09-12T15:00:00.000Z",
    time: "10:00",
    field: "Quitman High Gym",
    away_team_id: "t_b",
    home_team_id: "t_a",
    division: "3rd Grade Boys",
    status: "scheduled",
  });
  // Outside the range.
  store.set(`leagues/${L}/games/g3`, {
    date: "2026-10-03",
    time: "09:00",
    field: "Mineola Community Gym",
    away_team_id: "t_a",
    home_team_id: "t_b",
    status: "scheduled",
  });
}

const shiftDocs = () =>
  [...store.keys()].filter((p) => p.startsWith(`leagues/${L}/snackbar_shifts/`));

beforeEach(() => {
  store.clear();
  autoId = 0;
  state.decoded = ADMIN;
  state.sets = 0;
  seedSchedule();
});
afterEach(() => vi.clearAllMocks());

// ── generate_from_schedule ──────────────────────────────────────────────

describe("generate_from_schedule", () => {
  const range = { action: "generate_from_schedule", from: "2026-09-12", to: "2026-09-19", jobs: THREE_JOBS };

  it("makes one shift per game per job for games in the range, with claims empty", async () => {
    const res = await POST(req(range));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, games: 2, created: 6, updated: 0 });
    expect(shiftDocs().sort()).toEqual(
      [
        "g1__clock", "g1__scorebook", "g1__snack_bar",
        "g2__clock", "g2__scorebook", "g2__snack_bar",
      ].map((id) => `leagues/${L}/snackbar_shifts/${id}`).sort(),
    );
    expect(store.get(`leagues/${L}/snackbar_shifts/g2__snack_bar`)).toMatchObject({
      date: "2026-09-12",
      start: "10:00",
      location: "Quitman High Gym",
      slots: 2,
      job: "Snack Bar",
      game_id: "g2",
      game_label: "Quitman 3B Blue vs Mineola 3B Red — 3rd Grade Boys",
      claims: [],
      generated: true,
    });
    const audit = [...store.entries()].find(([p, d]) => p.includes("/audit/") && d.kind === "volunteer_shifts_generated");
    expect(audit?.[1]).toMatchObject({ by_role: "admin", created: 6, updated: 0 });
  });

  it("includes a game stamped with an ISO instant on the last day of the range", async () => {
    store.set(`leagues/${L}/games/g4`, {
      date: "2026-09-19T14:00:00.000Z",
      time: "09:00",
      field: "Mineola Community Gym",
      away_team_id: "t_a",
      home_team_id: "t_b",
      status: "scheduled",
    });
    const res = await POST(req(range));
    expect(await res.json()).toMatchObject({ games: 3, created: 9 });
    expect(store.get(`leagues/${L}/snackbar_shifts/g4__clock`)).toMatchObject({ date: "2026-09-19" });
  });

  it("run twice is a merge: no duplicates, and edits + sign-ups survive", async () => {
    await POST(req(range));
    // The admin bumps a shift to 5 slots and a parent signs up.
    const p = `leagues/${L}/snackbar_shifts/g1__clock`;
    store.set(p, {
      ...store.get(p)!,
      slots: 5,
      note: "bring a stopwatch",
      claims: [{ display_name: "Sarah M.", claimed_at: "x" }],
    });
    const res = await POST(req(range));
    expect(await res.json()).toMatchObject({ created: 0, updated: 6 });
    expect(shiftDocs()).toHaveLength(6);
    expect(store.get(p)).toMatchObject({
      slots: 5,
      note: "bring a stopwatch",
      claims: [{ display_name: "Sarah M.", claimed_at: "x" }],
      job: "Clock",
    });
  });

  it("limits the run to one gym when asked", async () => {
    const res = await POST(req({ ...range, gym: "quitman high gym" }));
    expect(await res.json()).toMatchObject({ created: 3 });
    expect(shiftDocs().every((p) => p.includes("g2__"))).toBe(true);
  });

  it("validates the range and the jobs", async () => {
    expect((await POST(req({ ...range, to: "2026-09-01" }))).status).toBe(400);
    expect((await POST(req({ ...range, from: "Sept 12" }))).status).toBe(400);
    expect((await POST(req({ ...range, jobs: [] }))).status).toBe(400);
    expect(shiftDocs()).toHaveLength(0);
  });

  it("a town commissioner with the volunteers scope may run it", async () => {
    state.decoded = MINEOLA;
    const res = await POST(req(range));
    expect(res.status).toBe(200);
    const audit = [...store.values()].find((d) => d.kind === "volunteer_shifts_generated");
    expect(audit).toMatchObject({ by_role: "mineola", town: "Mineola" });
  });
});

// ── authority ────────────────────────────────────────────────────────────

describe("admin actions refuse anyone without the volunteers scope", () => {
  const actions: Record<string, unknown>[] = [
    { action: "save_shifts", shifts: [{ date: "2026-09-12", start: "09:00", slots: 1 }] },
    { action: "delete_shift", shiftId: "g1__clock" },
    { action: "generate_from_schedule", from: "2026-09-12", to: "2026-09-19", jobs: THREE_JOBS },
    { action: "list_claims", from: "2026-09-12", to: "2026-09-19" },
  ];

  for (const [label, who] of [
    ["the umpire in chief", UMPIRE],
    ["a captain", CAPTAIN],
    ["another league's admin", OTHER_LEAGUE_ADMIN],
  ] as const) {
    it(`${label}: 403 on every admin action, nothing written`, async () => {
      state.decoded = who;
      store.set(`leagues/${L}/snackbar_shifts/g1__clock`, { date: "2026-09-12", start: "09:00", slots: 1, claims: [] });
      state.sets = 0;
      for (const body of actions) {
        const res = await POST(req(body));
        expect(res.status, body.action as string).toBe(403);
      }
      expect(state.sets).toBe(0);
      expect(store.has(`leagues/${L}/snackbar_shifts/g1__clock`)).toBe(true);
    });
  }

  it("no token at all: 403", async () => {
    state.decoded = null;
    const res = await POST(req({ action: "list_claims", from: "2026-09-12", to: "2026-09-19" }, false));
    expect(res.status).toBe(403);
  });
});

// ── list_claims ──────────────────────────────────────────────────────────

describe("list_claims", () => {
  beforeEach(async () => {
    await POST(req({ action: "generate_from_schedule", from: "2026-09-12", to: "2026-09-19", jobs: THREE_JOBS }));
    // Two parents sign up through the public action.
    state.decoded = null;
    for (const [name, email, phone] of [
      ["Sarah Mitchell", "sarah@example.com", "903-555-0100"],
      ["Tom Baker", "tom@example.com", ""],
    ]) {
      const res = await POST(req({ action: "claim", shiftId: "g1__snack_bar", name, email, phone }, false));
      expect(res.status).toBe(200);
    }
    state.decoded = ADMIN;
  });

  it("the public board doc never carries contact details", () => {
    const pub = JSON.stringify(store.get(`leagues/${L}/snackbar_shifts/g1__snack_bar`));
    expect(pub).not.toContain("example.com");
    expect(pub).not.toContain("555");
    expect(pub).toContain("Sarah M.");
  });

  it("the admin gets names, emails and phones for one shift", async () => {
    const res = await POST(req({ action: "list_claims", shiftId: "g1__snack_bar" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shifts: Array<{ id: string; contacts: Array<{ name: string; email: string; phone: string }> }> };
    expect(body.shifts).toHaveLength(1);
    expect(body.shifts[0]!.contacts).toEqual([
      expect.objectContaining({ name: "Sarah Mitchell", email: "sarah@example.com", phone: "903-555-0100" }),
      expect.objectContaining({ name: "Tom Baker", email: "tom@example.com", phone: "" }),
    ]);
  });

  it("a released volunteer drops off the sheet", async () => {
    state.decoded = null;
    await POST(req({ action: "release", shiftId: "g1__snack_bar", name: "Tom Baker" }, false));
    state.decoded = ADMIN;
    const res = await POST(req({ action: "list_claims", from: "2026-09-12", to: "2026-09-12" }));
    const body = (await res.json()) as { shifts: Array<{ id: string; contacts: Array<{ name: string }> }> };
    const snack = body.shifts.find((s) => s.id === "g1__snack_bar")!;
    expect(snack.contacts.map((c) => c.name)).toEqual(["Sarah Mitchell"]);
    // The range form returns every shift in the range, empty ones included.
    expect(body.shifts).toHaveLength(6);
  });
});

// ── public rate limit ────────────────────────────────────────────────────

describe("public sign-up rate limit", () => {
  it("cuts one address off after 30 claims or releases in the window, admins unaffected", async () => {
    store.set(`leagues/${L}/snackbar_shifts/s1`, { date: "2026-09-12", start: "09:00", slots: 1, claims: [] });
    state.decoded = null;
    const ip = "203.0.113.77";
    let last = 0;
    for (let i = 0; i < 30; i++) {
      const res = await POST(req({ action: "release", shiftId: "s1", name: `Nobody ${i}` }, false, ip));
      last = res.status;
    }
    expect(last).toBe(200);
    const blocked = await POST(req({ action: "claim", shiftId: "s1", name: "Sarah Mitchell" }, false, ip));
    expect(blocked.status).toBe(429);
    // A different address is not affected, and neither is an admin write.
    const other = await POST(req({ action: "claim", shiftId: "s1", name: "Sarah Mitchell" }, false, "203.0.113.78"));
    expect(other.status).toBe(200);
    state.decoded = ADMIN;
    const admin = await POST(req({ action: "save_shifts", shifts: [{ id: "s1", date: "2026-09-12", start: "09:00", slots: 2 }] }, true, ip));
    expect(admin.status).toBe(200);
  });
});

// ── save_shifts / delete_shift ───────────────────────────────────────────

describe("save_shifts", () => {
  it("a shift saved without a job is a snack-bar shift; with one, keeps it", async () => {
    const res = await POST(
      req({
        action: "save_shifts",
        shifts: [
          { id: "old-style", date: "2026-09-12", start: "17:30", slots: 2 },
          { id: "clock1", date: "2026-09-12", start: "09:00", slots: 1, job: "Clock", game_label: "A vs B" },
        ],
      }),
    );
    expect(await res.json()).toMatchObject({ ok: true, saved: 2 });
    expect(store.get(`leagues/${L}/snackbar_shifts/old-style`)).toMatchObject({ job: "Snack Bar" });
    expect(store.get(`leagues/${L}/snackbar_shifts/clock1`)).toMatchObject({ job: "Clock", game_label: "A vs B" });
  });

  it("re-saving a shift keeps the claims on it", async () => {
    store.set(`leagues/${L}/snackbar_shifts/s1`, {
      date: "2026-09-12", start: "09:00", slots: 1,
      claims: [{ display_name: "Sarah M.", claimed_at: "x" }],
    });
    await POST(req({ action: "save_shifts", shifts: [{ id: "s1", date: "2026-09-12", start: "09:30", slots: 3 }] }));
    expect(store.get(`leagues/${L}/snackbar_shifts/s1`)).toMatchObject({
      start: "09:30", slots: 3, claims: [{ display_name: "Sarah M.", claimed_at: "x" }],
    });
  });

  it("delete_shift removes the doc and audits it", async () => {
    store.set(`leagues/${L}/snackbar_shifts/s1`, { date: "2026-09-12", start: "09:00", slots: 1, claims: [] });
    const res = await POST(req({ action: "delete_shift", shiftId: "s1" }));
    expect(res.status).toBe(200);
    expect(store.has(`leagues/${L}/snackbar_shifts/s1`)).toBe(false);
    expect([...store.values()].some((d) => d.kind === "volunteer_shift_deleted")).toBe(true);
  });
});

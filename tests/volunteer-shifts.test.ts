import { describe, it, expect } from "vitest";
import {
  DEFAULT_JOB,
  DEFAULT_JOBS,
  displayName,
  gameLabel,
  jobOf,
  jobOrder,
  normaliseJob,
  projectPublicClaim,
  normaliseClaim,
  openSlots,
  shiftIdFor,
  shiftsFromGames,
  type GameForShift,
} from "../lib/volunteer-shifts";

describe("displayName", () => {
  it("reduces a full name to first name + last initial", () => {
    expect(displayName("Sarah Mitchell")).toBe("Sarah M.");
    expect(displayName("  jo   ann  Baker ")).toBe("jo ann B.");
  });

  it("leaves a single-word name alone rather than inventing an initial", () => {
    expect(displayName("Sarah")).toBe("Sarah");
  });

  it("returns empty for empty input", () => {
    expect(displayName("")).toBe("");
    expect(displayName("   ")).toBe("");
  });
});

describe("projectPublicClaim", () => {
  const now = "2026-04-18T12:00:00.000Z";

  it("publishes only a display name and a timestamp", () => {
    const pub = projectPublicClaim(
      { name: "Sarah Mitchell", email: "sarah@example.com", phone: "717-555-0100" },
      now,
    );
    expect(pub).toEqual({ display_name: "Sarah M.", claimed_at: now });
  });

  it("cannot leak a contact field even when one is supplied", () => {
    const pub = projectPublicClaim(
      {
        name: "Sarah Mitchell",
        email: "sarah@example.com",
        phone: "717-555-0100",
        // Fields the form does not have today but might grow later — and the
        // shift fields that DO exist now, which a careless spread could copy.
        ...({
          address: "12 Elm St",
          note: "call me",
          job: "Clock",
          game_id: "g1",
          game_label: "X vs Y",
        } as Record<string, unknown>),
      },
      now,
    );
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain("example.com");
    expect(serialized).not.toContain("555");
    expect(serialized).not.toContain("Elm");
    expect(Object.keys(pub!)).toEqual(["display_name", "claimed_at"]);
  });

  it("refuses a claim with no usable name", () => {
    expect(projectPublicClaim({ name: "  " }, now)).toBeNull();
  });
});

describe("normaliseClaim", () => {
  it("trims and bounds the private fields", () => {
    const c = normaliseClaim({
      name: "  Sarah Mitchell  ",
      email: " sarah@example.com ",
      phone: " 717-555-0100 ",
    });
    expect(c).toEqual({
      name: "Sarah Mitchell",
      email: "sarah@example.com",
      phone: "717-555-0100",
    });
  });

  it("caps absurdly long input rather than storing it", () => {
    const c = normaliseClaim({ name: "x".repeat(500) });
    expect(c!.name.length).toBe(80);
  });

  it("requires a name", () => {
    expect(normaliseClaim({ email: "a@b.com" })).toBeNull();
  });
});

describe("openSlots", () => {
  it("counts remaining places", () => {
    expect(openSlots({ slots: 3, claims: [] })).toBe(3);
    expect(
      openSlots({ slots: 3, claims: [{ display_name: "A", claimed_at: "" }] }),
    ).toBe(2);
  });

  it("never goes negative when a shift is shrunk after sign-ups", () => {
    expect(
      openSlots({
        slots: 1,
        claims: [
          { display_name: "A", claimed_at: "" },
          { display_name: "B", claimed_at: "" },
        ],
      }),
    ).toBe(0);
  });
});

// ── Jobs and game-generated shifts (ETBL) ─────────────────────────────

describe("jobOf / normaliseJob", () => {
  it("a shift saved before jobs existed is a snack-bar shift", () => {
    expect(jobOf({})).toBe(DEFAULT_JOB);
    expect(jobOf({ job: "" })).toBe(DEFAULT_JOB);
    expect(jobOf({ job: "   " })).toBe(DEFAULT_JOB);
    expect(DEFAULT_JOB).toBe("Snack Bar");
  });

  it("keeps a custom label, trimmed and capped", () => {
    expect(jobOf({ job: " Clock " })).toBe("Clock");
    expect(normaliseJob("Gate table")).toBe("Gate table");
    expect(normaliseJob("x".repeat(100))).toHaveLength(40);
    expect(normaliseJob(undefined)).toBe(DEFAULT_JOB);
  });

  it("orders the default jobs as listed, custom ones after", () => {
    expect(DEFAULT_JOBS).toEqual(["Clock", "Scorebook", "Snack Bar"]);
    expect(jobOrder("Clock")).toBeLessThan(jobOrder("Scorebook"));
    expect(jobOrder("Scorebook")).toBeLessThan(jobOrder("Snack Bar"));
    expect(jobOrder("Snack Bar")).toBeLessThan(jobOrder("Gate table"));
  });
});

describe("shiftIdFor", () => {
  it("is deterministic and readable", () => {
    expect(shiftIdFor("g_abc123", "Snack Bar")).toBe("g_abc123__snack_bar");
    expect(shiftIdFor("g_abc123", "Snack Bar")).toBe(shiftIdFor("g_abc123", "Snack Bar"));
  });

  it("always satisfies the API's id charset, whatever the game id held", () => {
    for (const raw of ["g/w1 3b#1", "g-w1-3b-1", "x".repeat(200)]) {
      expect(shiftIdFor(raw, "Clock")).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
  });

  it("never lets two jobs on one game collide, even on a long game id", () => {
    const long = "g".repeat(80);
    expect(shiftIdFor(long, "Clock")).not.toBe(shiftIdFor(long, "Scorebook"));
    expect(shiftIdFor(long, "Clock").endsWith("__clock")).toBe(true);
  });
});

describe("gameLabel", () => {
  it("names both teams and the division", () => {
    expect(gameLabel({ away: "Mineola", home: "Quitman", division: "4th Grade Boys" })).toBe(
      "Mineola vs Quitman — 4th Grade Boys",
    );
  });

  it("leaves the division off when there is none", () => {
    expect(gameLabel({ away: "Mineola", home: "Quitman" })).toBe("Mineola vs Quitman");
    expect(gameLabel({ away: "Mineola", home: "Quitman", division: "  " })).toBe(
      "Mineola vs Quitman",
    );
  });
});

describe("shiftsFromGames", () => {
  const names: Record<string, string> = {
    t_min: "Mineola 3B Red",
    t_quit: "Quitman 3B Blue",
    t_hawk: "Hawkins 3B Gold",
  };
  const nameOf = (id: string) => names[id] ?? id;
  const game = (over: Partial<GameForShift> & { id: string }): GameForShift => ({
    date: "2026-09-12",
    time: "09:00",
    field: "Mineola Community Gym",
    away_team_id: "t_min",
    home_team_id: "t_quit",
    division: "3rd Grade Boys",
    status: "scheduled",
    ...over,
  });
  const jobs = [
    { job: "Clock", slots: 1 },
    { job: "Scorebook", slots: 1 },
  ];

  it("makes one shift per game per job, with the label and gym on each", () => {
    const out = shiftsFromGames(
      [game({ id: "g1" }), game({ id: "g2", time: "10:00" }), game({ id: "g3", time: "11:00" })],
      nameOf,
      jobs,
    );
    expect(out).toHaveLength(6);
    expect(new Set(out.map((s) => s.id)).size).toBe(6);
    expect(out[0]).toMatchObject({
      id: "g1__clock",
      date: "2026-09-12",
      start: "09:00",
      location: "Mineola Community Gym",
      slots: 1,
      job: "Clock",
      game_id: "g1",
      game_label: "Mineola 3B Red vs Quitman 3B Blue — 3rd Grade Boys",
    });
  });

  it("is idempotent: the same schedule yields the same ids", () => {
    const games = [game({ id: "g1" }), game({ id: "g2" })];
    const a = shiftsFromGames(games, nameOf, jobs).map((s) => s.id);
    const b = shiftsFromGames(games, nameOf, jobs).map((s) => s.id);
    expect(a).toEqual(b);
  });

  it("skips games that are not being played", () => {
    const out = shiftsFromGames(
      [
        game({ id: "g1", status: "ppd" }),
        game({ id: "g2", status: "postponed" }),
        game({ id: "g3", status: "cancelled" }),
        game({ id: "g4", status: "draft" }),
        game({ id: "g5", status: "final" }),
        game({ id: "g6", status: "" }),
      ],
      nameOf,
      jobs,
    );
    expect(out.map((s) => s.game_id)).toEqual(["g5", "g5", "g6", "g6"]);
  });

  it("skips games with no usable date or time", () => {
    const out = shiftsFromGames(
      [game({ id: "g1", date: "" }), game({ id: "g2", time: "" }), game({ id: "g3", time: "TBD" })],
      nameOf,
      jobs,
    );
    expect(out).toHaveLength(0);
  });

  it("filters to one gym, case-insensitively", () => {
    const out = shiftsFromGames(
      [game({ id: "g1" }), game({ id: "g2", field: "Quitman High Gym" })],
      nameOf,
      jobs,
      "mineola community gym",
    );
    expect(out.map((s) => s.game_id)).toEqual(["g1", "g1"]);
  });

  it("clamps slots to 1–20 and drops a duplicate job", () => {
    const out = shiftsFromGames(
      [game({ id: "g1" })],
      nameOf,
      [
        { job: "Snack Bar", slots: 99 },
        { job: "Clock", slots: 0 },
        { job: " Clock ", slots: 3 },
      ],
    );
    expect(out.map((s) => [s.job, s.slots])).toEqual([
      ["Snack Bar", 20],
      ["Clock", 1],
    ]);
  });

  it("falls back to the team id when no name is known", () => {
    const out = shiftsFromGames([game({ id: "g1", away_team_id: "t_unknown" })], nameOf, jobs);
    expect(out[0]!.game_label).toBe("t_unknown vs Quitman 3B Blue — 3rd Grade Boys");
  });
});

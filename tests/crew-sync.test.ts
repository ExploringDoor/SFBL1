// Taking umpire assignments back from the system that made them.
//
// The league's schedule is the record here; the crew is not. Everything below
// guards the boundary: what a caller has to prove, what shapes are accepted,
// and the one decision that decides whether a league's roster stays clean or
// doubles on the first sync, which is how an incoming person is matched to
// somebody already on the books.

import { describe, expect, it } from "vitest";
import {
  authorizeCrewSync,
  crewChanged,
  matchUmpire,
  parseCrews,
  type IncomingUmpire,
} from "@/lib/crew-sync";

const SECRET = "s3cr3t-value-long-enough";

describe("who is allowed to write a crew", () => {
  it("accepts the secret as a bearer token", () => {
    expect(authorizeCrewSync({ authorization: `Bearer ${SECRET}` }, SECRET)).toBe(true);
  });

  it("accepts it in the header, for a hand-run curl", () => {
    expect(authorizeCrewSync({ secret: SECRET }, SECRET)).toBe(true);
  });

  // The failure that matters: a deploy where nobody set the env var must not
  // become a public write endpoint.
  it("refuses EVERYONE when the secret is not configured", () => {
    expect(authorizeCrewSync({ authorization: `Bearer ${SECRET}` }, undefined)).toBe(false);
    expect(authorizeCrewSync({ authorization: "Bearer " }, "")).toBe(false);
    expect(authorizeCrewSync({ secret: "anything" }, undefined)).toBe(false);
  });

  it("refuses a wrong or empty secret", () => {
    expect(authorizeCrewSync({ authorization: `Bearer ${SECRET}x` }, SECRET)).toBe(false);
    expect(authorizeCrewSync({ authorization: "Bearer nope" }, SECRET)).toBe(false);
    expect(authorizeCrewSync({}, SECRET)).toBe(false);
    expect(authorizeCrewSync({ authorization: null, secret: null }, SECRET)).toBe(false);
  });

  it("does not accept a prefix of the secret", () => {
    expect(authorizeCrewSync({ secret: SECRET.slice(0, 10) }, SECRET)).toBe(false);
  });
});

describe("what shapes are accepted", () => {
  it("reads a normal crew", () => {
    const got = parseCrews([
      { gameId: "KNHIYu5hS6kQQerr18HF", umpires: [{ name: "Robert Fuchsman", email: "R.Fuchsman@Example.com" }] },
    ]);
    expect(got).toEqual([
      {
        gameId: "KNHIYu5hS6kQQerr18HF",
        umpires: [{ name: "Robert Fuchsman", email: "r.fuchsman@example.com" }],
      },
    ]);
  });

  it("keeps an empty crew, because clearing a game is a real instruction", () => {
    expect(parseCrews([{ gameId: "abc", umpires: [] }])).toEqual([
      { gameId: "abc", umpires: [] },
    ]);
  });

  it("skips a game id that could not be a document id", () => {
    const got = parseCrews([
      { gameId: "../../etc/passwd", umpires: [{ name: "X" }] },
      { gameId: "", umpires: [{ name: "Y" }] },
      { gameId: "ok1", umpires: [{ name: "Z" }] },
    ])
    expect(got.map((c) => c.gameId)).toEqual(["ok1"]);
  });

  it("skips an umpire with no name", () => {
    const got = parseCrews([{ gameId: "g1", umpires: [{ email: "a@b.c" }, { name: "Real" }] }]);
    expect(got[0]!.umpires.map((u) => u.name)).toEqual(["Real"]);
  });

  it("collapses the same person listed twice on one game", () => {
    const got = parseCrews([
      {
        gameId: "g1",
        umpires: [
          { name: "Sam Reed", email: "sam@x.com" },
          { name: "Sam Reed", email: "SAM@x.com" },
        ],
      },
    ]);
    expect(got[0]!.umpires).toHaveLength(1);
  });

  it("caps a crew rather than accepting a hundred names", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `Ump ${i}` }));
    expect(parseCrews([{ gameId: "g1", umpires: many }])[0]!.umpires).toHaveLength(6);
  });

  it("returns nothing for junk", () => {
    expect(parseCrews(null)).toEqual([]);
    expect(parseCrews("nope")).toEqual([]);
    expect(parseCrews([null, 3, "x"])).toEqual([]);
  });
});

describe("matching an incoming umpire to the league's roster", () => {
  const byEmail = new Map([["bob@x.com", "u-bob"]]);
  const byName = new Map([["bob fuchsman", "u-bob"], ["mike tunstall", "u-mike"]]);
  const u = (name: string, email = ""): IncomingUmpire => ({ name, email });

  it("matches on email first", () => {
    expect(matchUmpire(u("Robert Fuchsman", "bob@x.com"), byEmail, byName)).toBe("u-bob");
  });

  // The whole reason email wins: the assigner may hold a fuller version of the
  // name than the league site does.
  it("matches on email even when the name is written differently", () => {
    expect(matchUmpire(u("Bob F.", "bob@x.com"), byEmail, byName)).toBe("u-bob");
  });

  it("falls back to the name for a league that never collected emails", () => {
    expect(matchUmpire(u("Mike Tunstall"), byEmail, byName)).toBe("u-mike");
    expect(matchUmpire(u("  mike TUNSTALL "), byEmail, byName)).toBe("u-mike");
  });

  it("returns null for somebody genuinely new, so the caller mints one", () => {
    expect(matchUmpire(u("Brand New", "new@x.com"), byEmail, byName)).toBeNull();
  });

  it("does not match an unknown email onto a same-named person by accident", () => {
    // The name still wins here, which is deliberate: two people with the same
    // full name in one chapter is rarer than one person with two addresses.
    expect(matchUmpire(u("Mike Tunstall", "different@x.com"), byEmail, byName)).toBe("u-mike");
  });
});

describe("deciding whether a game actually changed", () => {
  it("says no when the crew is identical", () => {
    expect(crewChanged(["a", "b"], ["a", "b"])).toBe(false);
  });

  it("says yes when somebody is added or dropped", () => {
    expect(crewChanged(["a"], ["a", "b"])).toBe(true);
    expect(crewChanged(["a", "b"], ["a"])).toBe(true);
  });

  // Position matters: the first name is the plate umpire, and moving somebody
  // there is a change worth writing even though the same two people work it.
  it("says yes when the same two swap plate and base", () => {
    expect(crewChanged(["a", "b"], ["b", "a"])).toBe(true);
  });

  it("says yes when a game is cleared", () => {
    expect(crewChanged(["a"], [])).toBe(true);
  });

  it("says no for two empties, so an unassigned game is not rewritten forever", () => {
    expect(crewChanged([], [])).toBe(false);
  });
});

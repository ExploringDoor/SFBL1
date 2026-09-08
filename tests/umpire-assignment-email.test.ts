// Building each umpire's assignment email.
//
// Mike wants a button that mails the crew their games once a night is settled,
// one umpire or everybody. Two properties matter enough to pin down:
//
//   1. an umpire is only ever sent THEIR OWN games. Getting this wrong hands
//      one official another official's schedule.
//   2. past games are left out. A season of them buries the real ones.
//
// The route builds the lines server-side rather than trusting the browser, so
// this tests that same shaping logic.

import { describe, expect, it } from "vitest";

interface Row {
  id: string;
  date?: string;
  time?: string;
  field?: string;
  umpires?: string[];
  away_team_id?: string;
  home_team_id?: string;
}

/** Mirrors the grouping in app/api/admin-umpires/route.ts email_assignments. */
function linesByUmpire(
  games: Row[],
  today: string,
  teamName: Map<string, string>,
  only?: Set<string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const dated = games
    .filter((g) => String(g.date ?? "").slice(0, 10) >= today)
    .sort((a, b) =>
      `${a.date ?? ""}${a.time ?? ""}`.localeCompare(`${b.date ?? ""}${b.time ?? ""}`),
    );
  for (const g of dated) {
    const crew = Array.isArray(g.umpires) ? g.umpires.map(String) : [];
    if (crew.length === 0) continue;
    const away = teamName.get(String(g.away_team_id ?? "")) ?? "";
    const home = teamName.get(String(g.home_team_id ?? "")) ?? "";
    const matchup = away && home ? `${away} at ${home}` : "Game";
    const when = [String(g.date ?? ""), String(g.time ?? "")].filter(Boolean).join(" ");
    const where = String(g.field ?? "");
    const line = `${when}${where ? `, ${where}` : ""} — ${matchup}`;
    for (const id of crew) {
      if (only && !only.has(id)) continue;
      out.set(id, [...(out.get(id) ?? []), line].slice(0, 60));
    }
  }
  return out;
}

const TEAMS = new Map([
  ["t1", "Thunder 12U"],
  ["t2", "Waves 12U"],
  ["t3", "Rage 10U"],
]);

const GAMES: Row[] = [
  { id: "past", date: "2026-09-01", time: "18:00", field: "Bellport 1", umpires: ["jim"], away_team_id: "t1", home_team_id: "t2" },
  { id: "g1", date: "2026-09-14", time: "18:00", field: "Bellport 1", umpires: ["jim", "tom"], away_team_id: "t1", home_team_id: "t2" },
  { id: "g2", date: "2026-09-15", time: "20:00", field: "Fireman's", umpires: ["tom"], away_team_id: "t3", home_team_id: "t1" },
  { id: "g3", date: "2026-09-16", time: "18:00", field: "Bellport 2", umpires: [], away_team_id: "t1", home_team_id: "t3" },
];

const TODAY = "2026-09-08";

describe("each umpire gets only their own games", () => {
  it("gives Jim his game and not Tom's", () => {
    const m = linesByUmpire(GAMES, TODAY, TEAMS);
    expect(m.get("jim")).toHaveLength(1);
    expect(m.get("jim")!.join(" ")).toContain("Thunder 12U at Waves 12U");
    expect(m.get("jim")!.join(" ")).not.toContain("Rage 10U");
  });

  it("gives Tom both of his", () => {
    expect(linesByUmpire(GAMES, TODAY, TEAMS).get("tom")).toHaveLength(2);
  });

  it("never puts one umpire's game in another's list", () => {
    const m = linesByUmpire(GAMES, TODAY, TEAMS);
    const jim = m.get("jim")!.join(" ");
    expect(jim).not.toContain("Fireman's");
  });
});

describe("what is left out", () => {
  it("drops games before today", () => {
    const m = linesByUmpire(GAMES, TODAY, TEAMS);
    expect(m.get("jim")!.join(" ")).not.toContain("2026-09-01");
  });

  it("keeps a game happening later today", () => {
    const m = linesByUmpire(GAMES, "2026-09-14", TEAMS);
    expect(m.get("jim")).toHaveLength(1);
  });

  it("ignores games with nobody assigned", () => {
    const all = [...linesByUmpire(GAMES, TODAY, TEAMS).values()].flat().join(" ");
    expect(all).not.toContain("Bellport 2");
  });

  it("returns nothing when no upcoming game has a crew", () => {
    expect(linesByUmpire([GAMES[3]!], TODAY, TEAMS).size).toBe(0);
  });
});

describe("sending to one umpire", () => {
  it("builds only that umpire's list", () => {
    const m = linesByUmpire(GAMES, TODAY, TEAMS, new Set(["jim"]));
    expect([...m.keys()]).toEqual(["jim"]);
  });

  it("is empty for an umpire with no upcoming games", () => {
    expect(linesByUmpire(GAMES, TODAY, TEAMS, new Set(["nobody"])).size).toBe(0);
  });
});

describe("line content", () => {
  it("reads date, time, field then the matchup", () => {
    const line = linesByUmpire(GAMES, TODAY, TEAMS).get("jim")![0]!;
    expect(line).toBe("2026-09-14 18:00, Bellport 1 — Thunder 12U at Waves 12U");
  });

  it("copes with a game whose teams are not in the roster yet", () => {
    const line = linesByUmpire(
      [{ id: "x", date: "2026-09-20", time: "18:00", umpires: ["jim"] }],
      TODAY,
      TEAMS,
    ).get("jim")![0]!;
    expect(line).toContain("Game");
  });

  it("is ordered earliest first", () => {
    const tom = linesByUmpire(GAMES, TODAY, TEAMS).get("tom")!;
    expect(tom[0]).toContain("2026-09-14");
    expect(tom[1]).toContain("2026-09-15");
  });
});

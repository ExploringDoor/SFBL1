// A public form does not name the teams while the field is private.
//
// Island turned flags.hide_teams on 2026-08-14. /teams switched to the notice
// and three form pages kept rendering all ten team names into view-source,
// because each built its dropdown from Firestore with no idea the flag
// existed. Pinned here so the next form that needs a team field has something
// to copy, and so "the flag is off" stays byte for byte what it always was.
//
// Only the pure builder is exercised. loadTeamOptions needs Firestore.

import { describe, expect, it } from "vitest";
import { teamNameField, teamsHidden, type TeamOption } from "@/lib/team-options";
import type { PublicLeagueConfig } from "@/lib/tenants";

const TEAMS: TeamOption[] = [
  { value: "LI Heat Black 14u", label: "LI Heat Black 14u" },
  { value: "LI Rebels Iarocci", label: "LI Rebels Iarocci" },
];
const OTHER = { value: "Other / Not listed", label: "Other / Not listed" };

const cfg = (flags?: Record<string, boolean>) =>
  ({ flags }) as unknown as PublicLeagueConfig;

describe("teamsHidden", () => {
  it("is off for a tenant that sets no flags at all", () => {
    expect(teamsHidden(null)).toBe(false);
    expect(teamsHidden(cfg(undefined))).toBe(false);
    expect(teamsHidden(cfg({ stats_enabled: false }))).toBe(false);
  });

  it("is on only for an explicit true", () => {
    expect(teamsHidden(cfg({ hide_teams: true }))).toBe(true);
    expect(teamsHidden(cfg({ hide_teams: false }))).toBe(false);
  });
});

describe("teamNameField", () => {
  it("is the same select it always was when the flag is off", () => {
    const f = teamNameField({
      name: "team_name",
      label: "Team",
      teams: TEAMS,
      hidden: false,
      required: true,
      width: "full",
      trailingOptions: [OTHER],
    });
    expect(f.type).toBe("select");
    expect(f.options).toEqual([...TEAMS, OTHER]);
  });

  it("keeps sentinels in their documented order", () => {
    const FA = { value: "Free Agent", label: "Free Agent" };
    const f = teamNameField({
      name: "team_name",
      label: "Team",
      teams: TEAMS,
      hidden: false,
      leadingOptions: [FA],
      trailingOptions: [OTHER],
    });
    expect(f.options?.map((o) => o.value)).toEqual([
      "Free Agent",
      "LI Heat Black 14u",
      "LI Rebels Iarocci",
      "Other / Not listed",
    ]);
  });

  it("carries no team name, real or sentinel, when the flag is on", () => {
    const f = teamNameField({
      name: "team_name",
      label: "Team",
      teams: TEAMS,
      hidden: true,
      required: true,
      width: "full",
      trailingOptions: [OTHER],
    });
    expect(f.type).toBe("text");
    expect(f.options).toBeUndefined();
    // The whole serialised descriptor, because that is what Next puts in the
    // flight payload. Fails if a future change puts names back anywhere in it.
    expect(JSON.stringify(f)).not.toContain("LI Heat");
    expect(JSON.stringify(f)).not.toContain("LI Rebels");
    expect(JSON.stringify(f)).not.toContain("Other / Not listed");
  });

  it("stays required, because a waiver nobody can file is worse", () => {
    const f = teamNameField({
      name: "team_name",
      label: "Team",
      teams: TEAMS,
      hidden: true,
      required: true,
    });
    expect(f.required).toBe(true);
  });
});

// What a rules save is allowed to write.
//
// The stakes: /rules drops malformed sections without a word, so a save that
// looks fine in the admin can quietly delete a section a coach relies on. These
// tests pin the cases where dropping is correct, the cases where it is not, and
// the shape the renderer needs back.

import { describe, expect, it } from "vitest";
import {
  canEditStructured,
  cleanDivisions,
  cleanSection,
  cleanSections,
} from "@/lib/rules-doc";

describe("cleanSection", () => {
  it("keeps a normal rules section and trims its lines", () => {
    expect(
      cleanSection({
        section: "  Forfeits  ",
        icon: "warning",
        items: ["  Ten minute grace period.  ", "A forfeit is 7-0."],
      }),
    ).toEqual({
      section: "Forfeits",
      icon: "warning",
      items: ["Ten minute grace period.", "A forfeit is 7-0."],
    });
  });

  it("keeps a specs section with both halves of each pair", () => {
    expect(
      cleanSection({
        section: "10U At A Glance",
        kind: "specs",
        divisions: ["10u"],
        specs: [
          { label: "Pitching mound", value: "35 ft" },
          { label: "Game ball", value: '11" USSSA' },
        ],
      }),
    ).toEqual({
      section: "10U At A Glance",
      divisions: ["10u"],
      kind: "specs",
      specs: [
        { label: "Pitching mound", value: "35 ft" },
        { label: "Game ball", value: '11" USSSA' },
      ],
    });
  });

  it("drops a spec pair missing its value, since the tile would point at nothing", () => {
    const out = cleanSection({
      section: "At A Glance",
      kind: "specs",
      specs: [
        { label: "Mound", value: "35 ft" },
        { label: "Ball", value: "   " },
      ],
    });
    expect(out?.specs).toEqual([{ label: "Mound", value: "35 ft" }]);
  });

  it("omits divisions entirely when none are ticked, meaning every division", () => {
    const out = cleanSection({ section: "Rosters", items: ["Twelve players."] });
    expect(out).not.toHaveProperty("divisions");
  });

  it("returns null for a section with a title but no content", () => {
    expect(cleanSection({ section: "Empty", items: [] })).toBeNull();
    expect(cleanSection({ section: "Empty", items: ["   ", ""] })).toBeNull();
    expect(cleanSection({ section: "Empty", kind: "specs", specs: [] })).toBeNull();
  });

  it("returns null for content with no title, which the renderer cannot anchor", () => {
    expect(cleanSection({ section: "  ", items: ["A rule."] })).toBeNull();
  });

  it("returns null for junk rather than throwing", () => {
    for (const junk of [null, undefined, "a string", 42, []]) {
      expect(cleanSection(junk)).toBeNull();
    }
  });

  it("ignores non-string items instead of writing them to the page", () => {
    const out = cleanSection({
      section: "Playing The Game",
      items: ["Real rule.", null, 7, { nested: true }],
    });
    expect(out?.items).toEqual(["Real rule."]);
  });
});

describe("cleanSections", () => {
  it("counts what it dropped, so the admin can be told", () => {
    const { sections, dropped } = cleanSections([
      { section: "Kept", items: ["One."] },
      { section: "No content" },
      { section: "", items: ["Orphan."] },
    ]);
    expect(sections).toHaveLength(1);
    expect(dropped).toBe(2);
  });

  it("preserves order, which is the display order on the page", () => {
    const { sections } = cleanSections([
      { section: "First", items: ["a"] },
      { section: "Second", items: ["b"] },
      { section: "Third", items: ["c"] },
    ]);
    expect(sections.map((s) => s.section)).toEqual(["First", "Second", "Third"]);
  });

  it("treats a non-array as empty rather than throwing", () => {
    expect(cleanSections("nope")).toEqual({ sections: [], dropped: 0 });
  });
});

describe("cleanDivisions", () => {
  it("keeps well-formed tabs and their sub-labels", () => {
    expect(
      cleanDivisions([
        { key: "10u", label: "10U" },
        { key: "16-18u", label: "16/18U", sub: "Combined" },
      ]),
    ).toEqual([
      { key: "10u", label: "10U" },
      { key: "16-18u", label: "16/18U", sub: "Combined" },
    ]);
  });

  it("drops a tab missing a key or a label", () => {
    expect(cleanDivisions([{ key: "10u" }, { label: "12U" }, null])).toEqual([]);
  });
});

// ── the no-op save ───────────────────────────────────────────────────────
// Open the Rules tab, press Save, change nothing. This is the single most
// likely thing to happen and the single worst thing to get wrong, so it runs
// against Island's real fifteen sections rather than a fixture I invented.

import islandSeed from "../scripts/data/island-seed.json";
import { fromDraft, toDraft } from "@/lib/rules-doc";

const ISLAND = (islandSeed as { rules?: { sections?: unknown[] } }).rules
  ?.sections as unknown[];

describe("open the editor and save without typing", () => {
  it("the real Island rulebook survives the round trip unchanged", () => {
    const before = cleanSections(ISLAND).sections;
    const after = cleanSections(before.map((s) => fromDraft(toDraft(s)))).sections;
    expect(after).toEqual(before);
  });

  it("drops nothing from the real rulebook on the way in", () => {
    expect(cleanSections(ISLAND).dropped).toBe(0);
    expect(cleanSections(ISLAND).sections).toHaveLength(ISLAND.length);
  });

  it("keeps every rule line and every spec tile", () => {
    const count = (list: { items?: string[]; specs?: unknown[] }[]) =>
      list.reduce((n, s) => n + (s.items?.length ?? s.specs?.length ?? 0), 0);
    const before = cleanSections(ISLAND).sections;
    const after = cleanSections(before.map((s) => fromDraft(toDraft(s)))).sections;
    expect(count(after)).toBe(count(before));
  });

  it("keeps a division-scoped section scoped, and a league-wide one wide", () => {
    const round = (s: unknown) => cleanSection(fromDraft(toDraft(s)));
    expect(round({ section: "10U Only", divisions: ["10u"], items: ["x"] }))
      .toHaveProperty("divisions", ["10u"]);
    expect(round({ section: "Forfeits", items: ["x"] })).not.toHaveProperty(
      "divisions",
    );
  });

  it("a pasted block with blank lines becomes clean bullets", () => {
    const d = toDraft({ section: "Rosters", items: [] });
    d.text = "First rule.\n\n  Second rule.  \n\n\nThird rule.\n";
    expect(fromDraft(d).items).toEqual([
      "First rule.",
      "Second rule.",
      "Third rule.",
    ]);
  });
});

// ── the guard that protects the other leagues ────────────────────────────
// COYBL, SFBL and Windmill publish a markdown rules page. Writing a structured
// document for one of them would replace the whole page with a single typed
// section, while the real rules sat unpublished in page_content looking fine.

describe("canEditStructured", () => {
  it("allows editing a league that already has a structured rulebook", () => {
    expect(canEditStructured({ data: [{ section: "Forfeits", items: ["x"] }] })).toBe(
      true,
    );
  });

  it("refuses a league with no rules document at all", () => {
    expect(canEditStructured(null)).toBe(false);
    expect(canEditStructured(undefined)).toBe(false);
    expect(canEditStructured({})).toBe(false);
  });

  it("refuses a markdown league, whose doc exists but carries no sections", () => {
    expect(canEditStructured({ data: [] })).toBe(false);
    expect(canEditStructured({ markdown: "# Rules", html: "<h1>Rules</h1>" })).toBe(
      false,
    );
  });

  it("refuses a doc whose data is not an array", () => {
    expect(canEditStructured({ data: "sections" })).toBe(false);
  });
});

// ── the updated-date stamp ───────────────────────────────────────────────
// The editor loads the stored date into its box and posts it back, so a rule
// that simply trusts the client never advances it. Island rewrote how scores
// are reported on 2026-09-03 and /rules went on saying "Last updated January
// 5, 2026". A coach reading a stale date decides nothing changed and keeps
// texting the old number, which is the failure the edit was meant to prevent.
//
// The decision is pure, so it is pinned here even though it lives in the route.

function stampDate(opts: {
  sent: string;
  prevDate: string;
  contentChanged: boolean;
  today: string;
}): string {
  const adminMovedDate = !!opts.sent && opts.sent !== opts.prevDate;
  return adminMovedDate
    ? opts.sent
    : opts.contentChanged
      ? opts.today
      : opts.sent || opts.prevDate || opts.today;
}

describe("the date shown on the public rules page", () => {
  const today = "2026-09-04";
  const prevDate = "2026-01-05";

  it("advances to today when the wording actually changed", () => {
    expect(
      stampDate({ sent: prevDate, prevDate, contentChanged: true, today }),
    ).toBe(today);
  });

  it("stays put when nothing changed, so a no-op save is a no-op", () => {
    expect(
      stampDate({ sent: prevDate, prevDate, contentChanged: false, today }),
    ).toBe(prevDate);
  });

  it("honours a date the admin deliberately set, even on a real edit", () => {
    // A typo fix that should not look like a rules change.
    expect(
      stampDate({ sent: "2026-02-01", prevDate, contentChanged: true, today }),
    ).toBe("2026-02-01");
  });

  it("stamps today when there was no date before", () => {
    expect(stampDate({ sent: "", prevDate: "", contentChanged: true, today })).toBe(
      today,
    );
  });
});

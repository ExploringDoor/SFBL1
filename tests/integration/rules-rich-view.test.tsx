// Guards the LEGACY (LBDC) path through RulesRichView.
//
// RulesRichView was generalized from LBDC's hardcoded saturday/boomers pair to
// an N-division, data-driven renderer so Island could have four age divisions.
// LBDC is live, and its rules doc has no `divisions` field, so it keeps taking
// the old title-sniffing path. These tests exist because that path can no
// longer be exercised locally: the dev server points at Island's Firebase, so
// lbdc.localhost 404s with "Tenant not found".
//
// renderToStaticMarkup runs the component's first render, which is all we need
// — the assertions are about the initial tab and which sections it selects.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RulesRichView } from "@/components/RulesRichView";

const LBDC_SECTIONS = [
  { icon: "⚾", section: "Game Rules", items: ["Saturday rule one"] },
  { icon: "🕐", section: "Boomers 60/70 — Game Length", items: ["Boomers rule one"] },
  { icon: "🔁", section: "Pool Players", items: ["Applies to both divisions"] },
  { icon: "⚖️", section: "Protests", items: ["Also both divisions"] },
];

describe("RulesRichView — legacy LBDC path", () => {
  const html = renderToStaticMarkup(
    <RulesRichView
      sections={LBDC_SECTIONS}
      divisionsAvailable={["saturday", "boomers"]}
    />,
  );

  it("renders both division tabs with their original labels", () => {
    expect(html).toContain("SATURDAY DIVISION");
    expect(html).toContain("BOOMERS RULES");
  });

  // Headings are uppercased by CSS text-transform, so the markup carries the
  // original casing — assert on that, not on the rendered appearance.
  it("defaults to saturday and shows only saturday + shared sections", () => {
    expect(html).toContain("Game Rules");
    expect(html).toContain("Pool Players");
    expect(html).toContain("Protests");
    // Boomers-only section must not be on the saturday tab.
    expect(html).not.toContain("Game Length");
  });

  it("still renders emoji icons verbatim rather than swallowing them", () => {
    // Legacy rows store literal emoji in `icon`; unknown icon keys must pass
    // through unchanged instead of rendering nothing.
    expect(html).toContain("⚾");
  });

  it("keeps the 2-up tab grid, not the generic wrap row", () => {
    expect(html).toContain("grid-template-columns:1fr 1fr");
  });
});

describe("RulesRichView — generic Island path", () => {
  const ISLAND = [
    {
      section: "10U At A Glance",
      icon: "clipboard",
      divisions: ["10u"],
      kind: "specs" as const,
      specs: [{ label: "Pitching mound", value: "35 ft" }],
    },
    { section: "10U Only", icon: "star", divisions: ["10u"], items: ["No dropped third strike"] },
    { section: "Playing The Game", icon: "ball", items: ["Applies to every division"] },
  ];
  const divisions = [
    { key: "10u", label: "10U", sub: "11 inch ball" },
    { key: "12u", label: "12U", sub: "12 inch ball" },
  ];

  const html = renderToStaticMarkup(
    <RulesRichView sections={ISLAND} divisions={divisions} />,
  );

  it("renders a tab per supplied division", () => {
    expect(html).toContain(">10U<");
    expect(html).toContain(">12U<");
  });

  it("shows division-scoped and shared sections on the first tab", () => {
    expect(html).toContain("10U At A Glance");
    expect(html).toContain("10U Only");
    // A section with no `divisions` applies everywhere.
    expect(html).toContain("Playing The Game");
  });

  it("renders specs as label/value pairs, not as a numbered list", () => {
    expect(html).toContain("Pitching mound");
    expect(html).toContain("35 ft");
  });

  it("uses SVG icons, never emoji, on the generic path", () => {
    expect(html).toContain("<svg");
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});

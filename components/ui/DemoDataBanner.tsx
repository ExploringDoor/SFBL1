// "This is a preview" strip, shown on every page that displays teams, games
// or standings while a league is running on sample data.
//
// Island launched before its Fall season starts, so Scores, Schedule and
// Standings were empty and a visiting coach could not tell what the site would
// look like in October. Mike asked for sample teams and results so they could
// (via Adam, 2026-08-12).
//
// The banner is the non-negotiable half of that. Realistic fake results with
// nothing saying so is how a parent concludes the season has already started,
// or that their daughter's team lost a game it never played. It is deliberately
// loud: amber, top of the content, above the data it is warning about.
//
// Driven by the tenant flag `demo_data`, which scripts/seed-demo-season.ts sets
// when it seeds and clears when it removes. One switch, so the banner cannot
// outlive the data or vice versa.

export function DemoDataBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="le-demo-banner" role="status">
      <strong>Sample data.</strong> These teams and results are examples so you
      can see how the site works. The Fall 2026 season starts September 12 and
      real scores replace this then.
    </div>
  );
}

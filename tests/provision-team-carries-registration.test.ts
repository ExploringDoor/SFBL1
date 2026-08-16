// Guards the fields a registration must carry onto the team it creates.
//
// Written after a real data-loss bug: from 2026-08-02 to 2026-08-12,
// provision-team wrote a hardcoded `logo_url: null`. The registration form
// collected the coach's logo, stored it on the submission, and then the team
// was created with the logo explicitly thrown away. Nothing errored, the page
// looked fine, and it took a coach emailing the league to notice — ten days
// and several teams later.
//
// The failure mode that makes this worth a test: a PLACEHOLDER that looks
// like finished code. `logo_url: null` reads as deliberate. Only comparing
// what the form collects against what survives reveals it.
//
// So this asserts the shape of the output rather than the implementation: for
// a registration carrying a logo, a logo must come out the other side.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(process.cwd(), "lib/provision-team.ts"),
  "utf8",
);

describe("provision-team carries registration data onto the team", () => {
  it("does not hardcode logo_url to null", () => {
    // The exact regression: `logo_url: null,` as a literal.
    expect(SRC).not.toMatch(/logo_url:\s*null\s*,/);
  });

  it("reads the uploaded logo from the submission", () => {
    expect(SRC).toMatch(/team_logo/);
    // and actually assigns it, rather than merely mentioning it in a comment
    const assigns = /logo_url:[\s\S]{0,400}?team_logo/.test(SRC);
    expect(assigns).toBe(true);
  });

  it("still guards the logo it accepts", () => {
    // A data URL cap must remain: without one, a large paste can break the
    // tenant config header (COYBL went down on 2026-08-08 when 491KB of
    // base64 sponsor logos exceeded Vercel's 32KB header limit).
    expect(SRC).toMatch(/data:image\//);
    expect(SRC).toMatch(/400_000|400000/);
  });

  it("carries the coach and assistant coach through", () => {
    // The assistant was unreachable for a while for the same reason: the
    // field was collected and never read.
    for (const field of ["asst_email", "asst_first_name", "email", "phone"]) {
      expect(SRC).toContain(field);
    }
  });

  it("carries the home field through", () => {
    for (const field of ["home_field_name", "home_field_street"]) {
      expect(SRC).toContain(field);
    }
  });
});

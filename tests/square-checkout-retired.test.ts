// The hosted Square payment link is retired. Two properties are pinned here:
// the route cannot come back to life, and no caller can be left pointing at it.
//
// It was not merely unused, it was silently harmful. It minted a link, wrote
// card.initiated_at, and stopped. Nothing read that field and there is no
// Square webhook, so three COYBL teams had a link minted for them and stayed
// unpaid in the ledger, on the Payments tab, and to the reminder emailer. See
// the header of app/api/square-checkout/route.ts.

import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

// No vi.mock: the retired route imports only next/server and reads the host
// off the Request, so it can be imported and called as it stands.
const { POST } = await import("@/app/api/square-checkout/route");

// vitest runs from the repo root, so cwd is stable. __dirname is not, under
// the ESM transform.
const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("/api/square-checkout is retired", () => {
  it("answers 410 and never returns a checkout url", async () => {
    const res = await POST(
      new Request("http://test/api/square-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // A real shaped Firestore id, so this cannot pass by accident on a
        // validation path that no longer exists.
        body: JSON.stringify({ registrationId: "aB3dE5gH7jK9mN1pQ3rS" }),
      }),
    );
    expect(res.status).toBe(410);
    const body = (await res.json()) as { url?: string; code?: string };
    // Both old callers branched on `url`. Its absence IS the contract: a
    // response carrying one would be treated as a live payment link.
    expect(body.url).toBeUndefined();
    expect(body.code).toBe("square_checkout_retired");
  });

  it("has no callers left anywhere in the app", () => {
    // A dead button is the failure this batch is most likely to ship. The
    // route stops working the moment it deploys, so a caller left behind is a
    // coach or an office clicking Pay and getting an error forever. Retiring
    // the endpoint and removing its two callers must land in ONE deploy, and
    // this is what makes forgetting that a red test instead of a phone call.
    const offenders: string[] = [];
    for (const dir of ["app", "components", "lib"]) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        // The retired route names itself in its own header.
        if (file.endsWith(path.join("api", "square-checkout", "route.ts"))) continue;
        const text = readFileSync(file, "utf8");
        // Matches a real call, not the several comments that still name the
        // route to explain why it is gone.
        if (/fetch\([^)]*["'`][^"'`]*\/api\/square-checkout/.test(text)) {
          offenders.push(path.relative(ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
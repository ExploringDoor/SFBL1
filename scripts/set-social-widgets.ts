// Point a league's social feed boxes at its Elfsight widgets.
//
//   SA_PATH=… TENANT=island IG=<id> FB=<id> TT=<id> npx tsx scripts/set-social-widgets.ts
//
// The ids are the UUID in each widget's embed code:
//   <div class="elfsight-app-A1B2C3D4-...">   →  A1B2C3D4-...
//
// Any network omitted is simply left out — the site renders only the boxes it
// has ids for, so this can be run once per network as they are created.
// Passing CLEAR=1 removes them all and the section disappears.
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "node:fs";

const SA_PATH = process.env.SA_PATH;
const TENANT = process.env.TENANT;
if (!SA_PATH || !existsSync(SA_PATH)) { console.error("SA_PATH required"); process.exit(1); }
if (!TENANT) { console.error("TENANT required"); process.exit(1); }

const sa = JSON.parse(readFileSync(SA_PATH, "utf8")) as { project_id: string };
initializeApp({ credential: cert(SA_PATH), projectId: sa.project_id });

// Each network accepts a different KIND of value, because each costs and
// requires something different:
//   IG  Elfsight widget id (paid — Instagram has no free live feed since 2024)
//   FB  the public page URL (free, Facebook's own Page Plugin, no login)
//   TT  Elfsight widget id (paid live feed) OR one tiktok video URL (free)
const UUID = /^[0-9a-fA-F-]{20,60}$/;
const URL_RE = /^https?:\/\//i;
(async () => {
  const ref = getFirestore().doc(`leagues/${TENANT}`);
  if (process.env.CLEAR === "1") {
    await ref.set({ social_widgets: {} }, { merge: true });
    console.log("cleared — the social section will not render");
    process.exit(0);
  }
  const next: Record<string, string> = {};
  for (const [key, env] of [["instagram","IG"],["facebook","FB"],["tiktok","TT"]] as const) {
    const v = (process.env[env] ?? "").trim();
    if (!v) continue;
    const ok =
      key === "facebook" ? URL_RE.test(v) :
      key === "tiktok"   ? UUID.test(v) || URL_RE.test(v) :
      key === "instagram"? UUID.test(v) || URL_RE.test(v) :
                           UUID.test(v);
    if (!ok) {
      console.error(
        `${env} looks wrong for ${key}. ` +
        (key === "facebook" ? "Expected the public page URL."
          : key === "tiktok" ? "Expected an Elfsight widget id or a tiktok.com video URL."
          : key === "instagram" ? "Expected an Elfsight widget id or an instagram.com post URL."
          : "Expected an Elfsight widget id."),
      );
      process.exit(1);
    }
    next[key] = v;
  }
  if (!Object.keys(next).length) { console.error("nothing to set — pass IG=, FB= and/or TT="); process.exit(1); }
  const cur = ((await ref.get()).data()?.social_widgets ?? {}) as Record<string, string>;
  const merged = { ...cur, ...next };
  await ref.set({ social_widgets: merged }, { merge: true });
  console.log("social_widgets =", JSON.stringify(merged, null, 1));
  process.exit(0);
})();

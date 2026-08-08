// One-off: write data/lcybl/fields.json into leagues/lcybl/site_config/fields.
import { readFileSync } from "node:fs";
import { getAdminDb } from "../lib/firebase-admin";
(async () => {
  const raw = JSON.parse(readFileSync("data/lcybl/fields.json", "utf8"));
  const fields = Array.isArray(raw) ? raw : (raw.fields ?? Object.values(raw)[0]);
  await getAdminDb()
    .doc("leagues/lcybl/site_config/fields")
    .set({ data: fields, updated_at: new Date().toISOString() });
  const withc = fields.filter((f: { lat?: number }) => f.lat).length;
  console.log(`seeded ${fields.length} fields (${withc} with coords)`);
  process.exit(0);
})();

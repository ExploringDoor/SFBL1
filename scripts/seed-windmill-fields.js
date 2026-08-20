// Seed Windmill's field directory data into leagues/windmill/site_config/fields.
//
// The platform's team docs + the stock fields page carry no TOWN and no
// "which teams play here" data — that lives only on the static site's
// teamIndex (home_field + town). This ports the union-find dedup from
// windmill-site/import/make_fields_page.py (collapses the same field entered
// with different spellings, ~69 raw -> ~35 unique) and writes a superset Field
// shape { name, town, teams[], variants[] } that FieldsWindmill renders and
// other tenants ignore.
//
// Run (emulator):
//   FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=league-platform-5f3c8 \
//     node scripts/seed-windmill-fields.js
// Live: FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY=... FIREBASE_PROJECT_ID=... node scripts/seed-windmill-fields.js

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const SRC = path.resolve(__dirname, "../../windmill-site/data/games.json");
const LEAGUE = "windmill";

const norm = (f) => String(f || "").replace(/[.,]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// union-find
const parent = {};
function find(x) {
  if (parent[x] === undefined) parent[x] = x;
  while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
  return x;
}
function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

const data = JSON.parse(fs.readFileSync(SRC, "utf8"));
const ti = data.teamIndex;

const raw = {};
for (const t of ti) {
  const f = String(t.home_field || "").trim();
  if (!f || /road/i.test(f)) continue;
  const nf = norm(f);
  const fid = "F:" + nf;
  const town = String(t.town || "").trim();
  const e = raw[nf] || (raw[nf] = { name: f, town, teams: new Set(), fid, variants: new Set() });
  if (f.length > e.name.length) e.name = f;
  e.teams.add(t.name);
  e.variants.add(nf);
  const tl = town.toLowerCase();
  const words = nf.match(/[a-z0-9]+/g) || [];
  union(fid, "P:" + words.slice(0, 2).join(" ") + "|" + tl);
  const nums = nf.match(/\d+/g) || [];
  if (nums.length) union(fid, "N:" + nums[0] + "|" + tl);
}

const clusters = {};
for (const nf of Object.keys(raw)) {
  const e = raw[nf];
  const r = find(e.fid);
  const c = clusters[r] || (clusters[r] = { name: e.name, town: e.town, teams: new Set(), variants: new Set() });
  if (e.name.length > c.name.length) c.name = e.name;
  if (e.town && !c.town) c.town = e.town;
  e.teams.forEach((x) => c.teams.add(x));
  e.variants.forEach((x) => c.variants.add(x));
}

const fields = Object.values(clusters)
  .map((c) => ({ name: c.name, town: c.town, teams: [...c.teams].sort(), variants: [...c.variants].sort() }))
  .sort((a, b) => a.town.localeCompare(b.town) || a.name.localeCompare(b.name));

function db() {
  const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const projectId = useEmulator
    ? process.env.GCLOUD_PROJECT || "demo-provision"
    : process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("no project id resolved");
  if (useEmulator) {
    admin.initializeApp({ projectId });
    console.log(`[windmill-fields] emulator ${process.env.FIRESTORE_EMULATOR_HOST}`);
  } else {
    const key = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    if (!key || !email) throw new Error("missing FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY");
    admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail: email, privateKey: key }) });
    console.log(`[windmill-fields] LIVE project ${projectId}`);
  }
  return admin.firestore();
}

(async () => {
  const store = db();
  await store.doc(`leagues/${LEAGUE}/site_config/fields`).set(
    { data: fields, updated_at: new Date().toISOString() },
    { merge: true },
  );
  const towns = new Set(fields.map((f) => f.town).filter(Boolean));
  console.log(`[windmill-fields] wrote ${fields.length} deduped fields across ${towns.size} towns`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });

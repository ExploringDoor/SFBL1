// Seed a per-team coach (captain) password for every Windmill team.
//
// Windmill is a YOUTH league, so its league config sets captain.require_password:true
// (strict). That means /api/public-captain-claim REFUSES any team without a configured
// password — it never falls back to the "trust the URL" model. This script is what
// gives every team that password, so coaches can actually log in.
//
// Each password is written to the PRIVATE subdoc teams/{id}/_private/auth
// (never world-readable), with a non-secret `has_captain_password:true` marker on the
// public team doc. Codes are dumped to a file OUTSIDE the repo so they never hit git.
//
// Run AFTER provisioning (so the team docs exist):
//   FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
//     GCLOUD_PROJECT=league-platform-5f3c8 npx tsx scripts/seed-windmill-captains.ts
// LIVE (prod) uses FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY + FIREBASE_PROJECT_ID.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const LEAGUE = "windmill";
const CSV = path.resolve(process.cwd(), "data/windmill/teams.csv");

function readCsv(file: string): Array<Record<string, string>> {
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  const head = splitRow(lines[0]!);
  return lines.slice(1).map((line) => {
    const cells = splitRow(line);
    const row: Record<string, string> = {};
    head.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}
function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// A friendly, coach-shareable code: the club word + 4 random digits (e.g. "tornados4821").
function makeCode(name: string): string {
  const club = String(name).split(" - ")[0] ?? "";
  const word = club.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "team";
  const n = crypto.randomInt(1000, 10000);
  return `${word}${n}`;
}

function db() {
  const useEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const projectId = useEmulator
    ? process.env.GCLOUD_PROJECT || "demo-provision"
    : process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("no project id resolved");
  if (useEmulator) {
    initializeApp({ projectId });
    console.log(`[windmill-captains] emulator ${process.env.FIRESTORE_EMULATOR_HOST}`);
  } else {
    const key = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    if (!key || !email) throw new Error("missing FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY");
    initializeApp({ credential: cert({ projectId, clientEmail: email, privateKey: key }) });
    console.log(`[windmill-captains] LIVE project ${projectId}`);
  }
  return getFirestore();
}

async function main() {
  const store = db();
  const teams = readCsv(CSV);
  const codes: Array<[string, string, string]> = [];
  for (const t of teams) {
    const code = makeCode(t.name || t.id!);
    await store.doc(`leagues/${LEAGUE}/teams/${t.id}/_private/auth`).set(
      { captain_password: code, updated_at: new Date().toISOString() },
      { merge: true },
    );
    await store.doc(`leagues/${LEAGUE}/teams/${t.id}`).set(
      { has_captain_password: true, updated_at: new Date().toISOString() },
      { merge: true },
    );
    codes.push([t.name!, t.division!, code]);
  }

  const codeDir = path.join(os.homedir(), ".windmill-demo");
  fs.mkdirSync(codeDir, { recursive: true });
  const codeFile = path.join(codeDir, "captain-codes.txt");
  fs.writeFileSync(
    codeFile,
    "Windmill Fastpitch Softball — coach (captain) codes\n" +
      "Team password for /captain login. Keep OUT of the repo.\n\n" +
      codes
        .sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))
        .map(([name, div, code]) => `${div.padEnd(10)} ${name.padEnd(40)} ${code}`)
        .join("\n") +
      "\n",
    { mode: 0o600 },
  );
  console.log(`[windmill-captains] seeded ${codes.length} team codes -> ${codeFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Fetches and prints the most-recent pending magic-link from the Auth
// Emulator. Useful when the Emulator UI (port 4000) isn't available.
//
// Usage:  npm run magic-link
// Optionally:  npm run magic-link -- <email>   to filter by email.
//
// Reads NEXT_PUBLIC_FIREBASE_PROJECT_ID from .env.local OR uses the
// emulator's project (whatever was passed to `firebase emulators:exec
// --project ...`). Defaults to "demo-test" if neither is set.

import * as fs from "node:fs";
import * as path from "node:path";

(function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (!process.env[k!]) process.env[k!] = (v ?? "").trim();
  }
})();

const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "localhost:9099";
const PROJECT_ID =
  process.env.GCLOUD_PROJECT ??
  process.env.FIREBASE_PROJECT_ID ??
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
  "league-platform-5f3c8";

const filterEmail = process.argv[2];

interface OobCode {
  email?: string;
  requestType: string;
  oobCode: string;
  oobLink: string;
}

async function main() {
  const url = `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/oobCodes`;
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) {
    console.error(
      `[magic-link] Couldn't reach Auth Emulator at ${url}.\n` +
        "Is `npm run dev:emulators` running in another terminal?",
    );
    process.exit(1);
  }
  const json = (await res.json()) as { oobCodes?: OobCode[] };
  const codes = (json.oobCodes ?? []).filter(
    (c) => c.requestType === "EMAIL_SIGNIN" && (!filterEmail || c.email === filterEmail),
  );

  if (codes.length === 0) {
    console.log(
      `[magic-link] No pending sign-in links${filterEmail ? ` for ${filterEmail}` : ""}.\n` +
        "Did you click 'Send sign-in link' on /login first?",
    );
    return;
  }

  // Most recent last; print all but make the last one stand out.
  for (const c of codes) console.log(`  ${c.email ?? "(no email)"} → ${c.oobLink}`);
  const last = codes[codes.length - 1]!;
  console.log("\n[magic-link] Most recent link:");
  console.log(`  ${last.oobLink}`);
  console.log(`\nOpen that URL in your browser to finish signing in.`);
}

main().catch((err) => {
  console.error("[magic-link] Failed:", err);
  process.exit(1);
});

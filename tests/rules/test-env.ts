import * as fs from "node:fs";
import * as path from "node:path";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

const RULES_PATH = path.resolve(__dirname, "..", "..", "firestore.rules");

// Each test file passes a unique projectId so they don't share state even
// if vitest is reconfigured to parallelize.
//
// Port is configurable via FIRESTORE_EMULATOR_PORT so the test runner
// can spin up its own emulator (e.g. on 8085) alongside an active dev
// emulator on the default 8080. firebase emulators:exec sets
// FIRESTORE_EMULATOR_HOST automatically; we parse that when present.
function getPort(): number {
  const hostEnv = process.env.FIRESTORE_EMULATOR_HOST;
  if (hostEnv) {
    const match = hostEnv.match(/:(\d+)$/);
    if (match) return parseInt(match[1]!, 10);
  }
  if (process.env.FIRESTORE_EMULATOR_PORT) {
    return parseInt(process.env.FIRESTORE_EMULATOR_PORT, 10);
  }
  return 8080;
}

export async function makeTestEnv(projectId: string): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, "utf8"),
      host: "127.0.0.1",
      port: getPort(),
    },
  });
}

// rules-unit-testing caches the underlying FirebaseApp by (uid + claims hash).
// Reusing the same uid across tests can trip "Firestore has already been
// started and its settings can no longer be changed" once enough contexts
// have been created. Always derive uids from this counter so each context
// gets its own app.
let _uidCounter = 0;
export function uid(label = "u"): string {
  _uidCounter += 1;
  return `${label}_${_uidCounter}`;
}

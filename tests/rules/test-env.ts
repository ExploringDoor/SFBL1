import * as fs from "node:fs";
import * as path from "node:path";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

const RULES_PATH = path.resolve(__dirname, "..", "..", "firestore.rules");

// Each test file passes a unique projectId so they don't share state even
// if vitest is reconfigured to parallelize.
export async function makeTestEnv(projectId: string): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, "utf8"),
      host: "127.0.0.1",
      port: 8080,
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

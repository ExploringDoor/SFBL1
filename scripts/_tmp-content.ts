import { readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.SA_PATH!, "utf8"))) });
const db = getFirestore();
async function main() {
  for (const id of ["coach-checklist", "manager-help"]) {
    const md = String((await db.doc(`leagues/coybl/page_content/${id}`).get()).data()?.markdown ?? "");
    console.log(`\n########## ${id} (${md.length} chars) ##########`);
    for (const l of md.split("\n")) if (/^#{1,3} /.test(l)) console.log("  " + l);
    console.log("  --- stale-fact scan ---");
    const checks: [string, RegExp][] = [
      ["password (should be 5-digit code)", /password/i],
      ["box score", /box score/i],
      ["attendance tab", /attendance/i],
      ["free agents tab", /free agent/i],
      ["payments tab", /payments tab|payments/i],
      ["notifications", /notification/i],
      ["calendar sync", /calendar/i],
      ["magic link / email sign-in", /magic link|sign in by email|set your password/i],
    ];
    for (const [label, re] of checks) {
      const hit = md.split("\n").filter(l => re.test(l)).slice(0, 2);
      if (hit.length) console.log(`   ! ${label}: ${hit[0]!.trim().slice(0, 110)}`);
    }
  }
}
main().then(()=>process.exit(0));

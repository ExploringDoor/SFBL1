import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
initializeApp({ credential: cert(process.env.SA_PATH!) });
const db = getFirestore();
const ON = process.env.ON === "1";
(async () => {
  const ref = db.doc("leagues/island");
  const cur: any = (await ref.get()).data() ?? {};
  const nav = cur.nav ?? {};
  const hide: string[] = Array.isArray(nav.hide) ? [...nav.hide] : [];

  if (ON) {
    if (!hide.some((x) => String(x).toLowerCase() === "teams")) hide.push("teams");
  } else {
    const i = hide.findIndex((x) => String(x).toLowerCase() === "teams");
    if (i >= 0) hide.splice(i, 1);
  }

  await ref.set(
    { flags: { ...(cur.flags ?? {}), hide_teams: ON }, nav: { ...nav, hide } },
    { merge: true },
  );

  const after: any = (await ref.get()).data() ?? {};
  console.log("flags.hide_teams :", after.flags?.hide_teams);
  console.log("nav.hide         :", JSON.stringify(after.nav?.hide));
  process.exit(0);
})();

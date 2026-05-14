// Build HTML for LBDC's /content/* pages from the structured data
// already in site_config/*. The platform's /content/<pageId> route
// reads /leagues/<id>/page_content/<pageId> and renders the html
// field. So we convert each LBDC config doc → HTML once, write to
// the right page_content path. Re-run any time the underlying
// structured data changes.
//
// Pages produced:
//   /content/sponsors    ← site_config/sponsors
//   /content/contact     ← site_config/contact
//   /content/pay-online  ← site_config/payment_categories
//
// Usage:
//   npx tsx scripts/seed-lbdc-content-pages.ts --league lbdc-staging

import * as fs from "node:fs";
import * as path from "node:path";
(function loadEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split("\n")) {
    const m = raw.trim().match(/^([A-Z0-9_]+)=(.+)/);
    if (m && !process.env[m[1]!])
      process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
})();
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
let league: string | null = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--league") league = args[++i] ?? null;
}
if (!league) {
  console.error("Usage: --league <slug>");
  process.exit(2);
}

initializeApp({
  credential: cert(
    path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH!),
  ),
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const db = getFirestore();

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function telHref(phone: string): string {
  return "tel:+1" + String(phone ?? "").replace(/[^0-9]/g, "");
}

// ── sponsors ────────────────────────────────────────────────────────
function sponsorsHtml(rows: Array<Record<string, unknown>>): string {
  return rows
    .map((s) => {
      const name = esc(String(s.name ?? ""));
      const role = esc(String(s.role ?? ""));
      const desc = esc(String(s.description ?? ""));
      const email = s.email ? String(s.email) : "";
      const website = s.website ? String(s.website) : "";
      const featured = s.featured ? " — Featured Sponsor" : "";
      const contact: string[] = [];
      if (email)
        contact.push(`<a href="mailto:${esc(email)}">${esc(email)}</a>`);
      if (website)
        contact.push(
          `<a href="${esc(website)}" target="_blank" rel="noreferrer">${esc(website)}</a>`,
        );
      return `<section style="margin-bottom:24px"><h2>${name}</h2><p><strong>${role}${featured}</strong></p><p>${desc}</p>${contact.length ? `<p>${contact.join(" · ")}</p>` : ""}</section>`;
    })
    .join("\n");
}

// ── contact ─────────────────────────────────────────────────────────
function contactHtml(c: Record<string, unknown>): string {
  const name = esc(String(c.commissionerName ?? ""));
  const title = esc(String(c.commissionerTitle ?? "League Commissioner"));
  const email = String(c.commissionerEmail ?? "");
  const phone = String(c.commissionerPhone ?? "");
  const venmo = String(c.venmoHandle ?? "");
  const zelle = esc(String(c.zelleNote ?? ""));
  const designerName = esc(String(c.designerName ?? ""));
  const designerEmail = String(c.designerEmail ?? "");
  const designerWebsite = String(c.designerWebsite ?? "");

  return `
<h2>${name}</h2>
<p><strong>${title}</strong></p>
${email ? `<p>Email: <a href="mailto:${esc(email)}">${esc(email)}</a></p>` : ""}
${phone ? `<p>Phone: <a href="${esc(telHref(phone))}">${esc(phone)}</a></p>` : ""}
${venmo ? `<p>Venmo: <strong>${esc(venmo)}</strong></p>` : ""}
${zelle ? `<p>Zelle: ${zelle}</p>` : ""}
${
  designerName
    ? `<hr><p style="font-size:13px;color:#666">Site by ${designerName}${
        designerEmail
          ? ` · <a href="mailto:${esc(designerEmail)}">${esc(designerEmail)}</a>`
          : ""
      }${
        designerWebsite
          ? ` · <a href="${esc(designerWebsite)}" target="_blank" rel="noreferrer">${esc(designerWebsite)}</a>`
          : ""
      }</p>`
    : ""
}
  `.trim();
}

// ── payment categories ──────────────────────────────────────────────
function paymentsHtml(
  cats: Array<Record<string, unknown>>,
  contact: Record<string, unknown>,
): string {
  const venmo = String(contact.venmoHandle ?? "");
  const phone = String(contact.commissionerPhone ?? "");
  const intro = `<p>All payments go to the league commissioner. Pick a fee type below for the amount + how to pay.</p>`;
  const list = cats
    .map((c) => {
      return `<section style="margin-bottom:16px"><h3>${esc(String(c.label ?? ""))} — <strong>${esc(String(c.amount ?? ""))}</strong></h3><p>${esc(String(c.note ?? ""))}</p></section>`;
    })
    .join("\n");
  const howToPay = `
<hr>
<h2>How to pay</h2>
<p><strong>Zelle</strong> — send to ${phone ? `<a href="${esc(telHref(phone))}">${esc(phone)}</a>` : "the commissioner's cell"}.</p>
${venmo ? `<p><strong>Venmo</strong> — ${esc(venmo)}</p>` : ""}
`.trim();
  return `${intro}\n${list}\n${howToPay}`;
}

(async () => {
  const [sponsorsSnap, contactSnap, paymentsSnap] = await Promise.all([
    db.doc(`leagues/${league}/site_config/sponsors`).get(),
    db.doc(`leagues/${league}/site_config/contact`).get(),
    db.doc(`leagues/${league}/site_config/payment_categories`).get(),
  ]);
  const sponsorsArr =
    (sponsorsSnap.exists && (sponsorsSnap.data()?.data as unknown)) || [];
  const contact = (contactSnap.exists && contactSnap.data()) || {};
  const paymentsArr =
    (paymentsSnap.exists && (paymentsSnap.data()?.data as unknown)) || [];

  const docs: Array<{ id: string; title: string; html: string }> = [];

  if (Array.isArray(sponsorsArr) && sponsorsArr.length > 0) {
    docs.push({
      id: "sponsors",
      title: "Sponsors",
      html: sponsorsHtml(sponsorsArr as Array<Record<string, unknown>>),
    });
  }
  if (Object.keys(contact).length > 0) {
    docs.push({
      id: "contact",
      title: "Contact",
      html: contactHtml(contact as Record<string, unknown>),
    });
  }
  if (Array.isArray(paymentsArr) && paymentsArr.length > 0) {
    docs.push({
      id: "pay-online",
      title: "Pay Online",
      html: paymentsHtml(
        paymentsArr as Array<Record<string, unknown>>,
        contact as Record<string, unknown>,
      ),
    });
  }

  for (const d of docs) {
    await db.doc(`leagues/${league}/page_content/${d.id}`).set(
      {
        html: d.html,
        markdown: "",
        title: d.title,
        updated_at: new Date().toISOString(),
        updated_by_uid: "lbdc-migration-script",
      },
      { merge: true },
    );
    console.log(
      `  /content/${d.id.padEnd(15)} ${d.html.length} chars written`,
    );
  }
  console.log(`[seed-content] ${docs.length} pages written to /leagues/${league}/page_content/*`);
  process.exit(0);
})();

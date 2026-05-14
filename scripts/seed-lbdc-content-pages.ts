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
function sponsorsHtml(
  rows: Array<Record<string, unknown>>,
  contact: Record<string, unknown>,
): string {
  const cards = rows
    .map((s) => {
      const name = esc(String(s.name ?? ""));
      const role = esc(String(s.role ?? ""));
      const desc = esc(String(s.description ?? ""));
      const email = s.email ? String(s.email) : "";
      const website = s.website ? String(s.website) : "";
      const featured = s.featured ? "⭐ " : "";
      const links: string[] = [];
      if (email)
        links.push(`<a href="mailto:${esc(email)}">${esc(email)}</a>`);
      if (website)
        links.push(
          `<a href="${esc(website)}" target="_blank" rel="noreferrer">${esc(website)}</a>`,
        );
      return `
<section style="background:white;border:1px solid rgba(0,0,0,0.08);border-left:4px solid #002d6e;border-radius:14px;padding:18px 22px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
  <h2 style="margin:0 0 4px;font-size:22px;font-weight:900;color:#111">${featured}${name}</h2>
  <p style="margin:0 0 10px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#002d6e">${role}</p>
  <p style="margin:0 0 ${links.length ? "10px" : "0"};font-size:15px;line-height:1.55;color:#374151">${desc}</p>
  ${links.length ? `<p style="margin:0;font-size:13px;color:#6b7280">${links.join(" · ")}</p>` : ""}
</section>`.trim();
    })
    .join("\n");

  const commName = esc(String(contact.commissionerName ?? "the league"));
  const commEmail = String(contact.commissionerEmail ?? "");
  const commPhone = String(contact.commissionerPhone ?? "");
  const ctaContact: string[] = [];
  if (commEmail)
    ctaContact.push(
      `<a href="mailto:${esc(commEmail)}" style="color:#FFD700;font-weight:700">${esc(commEmail)}</a>`,
    );
  if (commPhone)
    ctaContact.push(
      `<a href="${esc(telHref(commPhone))}" style="color:#FFD700;font-weight:700">${esc(commPhone)}</a>`,
    );

  const cta = `
<section style="background:linear-gradient(135deg,#002d6e 0%,#1a3a8a 100%);color:white;border-radius:14px;padding:24px 26px;margin-top:24px;box-shadow:0 4px 12px rgba(0,0,0,0.08)">
  <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.65)">Interested in sponsoring?</p>
  <h2 style="margin:0 0 12px;font-size:24px;font-weight:900;color:#FFD700;letter-spacing:0.01em">Support the league</h2>
  <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:rgba(255,255,255,0.9)">
    LBDC is keeping organized 50+ baseball alive in Southern California — and your business can be part of it. Sponsors get visibility across the site, on team gear, and at every game day. Reach out to ${commName} to discuss packages.
  </p>
  ${ctaContact.length ? `<p style="margin:0;font-size:14px">${ctaContact.join(" &nbsp;·&nbsp; ")}</p>` : ""}
</section>`.trim();

  return `${cards}\n${cta}`;
}

// ── contact ─────────────────────────────────────────────────────────
// Rich card layout matching the design Adam pasted: navy header
// strip with the commissioner's name + baseball icon, then four
// info rows (phone, email, Zelle, Venmo) each with an icon tile,
// label, blue value, tap-to-X subtext. Then a "Love this site?"
// CTA banner with the designer's contact.
function contactHtml(c: Record<string, unknown>): string {
  const name = esc(String(c.commissionerName ?? ""));
  const title = esc(
    String(c.commissionerTitle ?? "League Commissioner"),
  );
  const email = String(c.commissionerEmail ?? "");
  const phone = String(c.commissionerPhone ?? "");
  const venmo = String(c.venmoHandle ?? "");
  const zelleNote = esc(
    String(c.zelleNote ?? "Send to cell number above"),
  );
  const designerName = esc(String(c.designerName ?? ""));
  const designerEmail = String(c.designerEmail ?? "");
  const designerWebsite = String(c.designerWebsite ?? "");

  function row(
    icon: string,
    label: string,
    value: string,
    href: string,
    sub: string,
    blue = true,
  ): string {
    return `
<div style="display:flex;align-items:center;gap:14px;padding:18px 22px;border-bottom:1px solid rgba(0,0,0,0.06)">
  <div style="width:46px;height:46px;border-radius:12px;background:rgba(0,0,0,0.04);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">${icon}</div>
  <div style="flex:1;min-width:0">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#9ca3af;margin-bottom:4px">${esc(label)}</div>
    ${href ? `<a href="${esc(href)}" style="display:block;font-size:20px;font-weight:900;color:${blue ? "#002d6e" : "#111"};text-decoration:none;line-height:1.1;word-break:break-word">${esc(value)}</a>` : `<div style="font-size:20px;font-weight:900;color:${blue ? "#002d6e" : "#111"};line-height:1.1">${esc(value)}</div>`}
    ${sub ? `<div style="font-size:13px;color:#9ca3af;margin-top:4px">${esc(sub)}</div>` : ""}
  </div>
</div>`.trim();
  }

  const commissionerCard = `
<div style="background:white;border-radius:18px;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,0.07);margin-bottom:24px">
  <div style="background:#002d6e;padding:24px 28px;display:flex;align-items:center;gap:18px">
    <div style="width:64px;height:64px;border-radius:50%;background:white;display:flex;align-items:center;justify-content:center;font-size:32px;flex-shrink:0">⚾</div>
    <div>
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:rgba(255,255,255,0.7);margin-bottom:6px">${title}</div>
      <div style="font-size:30px;font-weight:900;color:white;letter-spacing:0.01em;line-height:1">${name}</div>
    </div>
  </div>
  ${phone ? row("📞", "Phone / Cell", phone, telHref(phone), "Tap to call") : ""}
  ${email ? row("✉️", "Email", email, `mailto:${email}`, "Tap to email") : ""}
  ${zelleNote ? row("💸", "Zelle", zelleNote, "", "", false) : ""}
  ${venmo ? row("📱", "Venmo", venmo, "", "", false) : ""}
</div>`.trim();

  const cta = designerName
    ? `
<div style="background:linear-gradient(135deg,#002d6e 0%,#1a3a8a 100%);color:white;border-radius:18px;padding:28px 30px;box-shadow:0 4px 18px rgba(0,0,0,0.08)">
  <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:rgba(255,255,255,0.6);margin-bottom:8px">Love this site?</div>
  <div style="font-size:26px;font-weight:900;color:#FFD700;letter-spacing:0.01em;line-height:1.15;margin-bottom:14px">Get a custom website built for your league</div>
  <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:rgba(255,255,255,0.85)">
    This site was built specifically for Long Beach Diamond Classics — every feature, every page, exactly how the league needs it. If your organization wants a fully custom website tailored to your team, league, or club, reach out to ${designerName.split(" ")[0]}!
  </p>
  ${designerWebsite ? `<a href="${esc(designerWebsite)}" target="_blank" rel="noreferrer" style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:12px;color:white;text-decoration:none;margin-bottom:10px"><span style="font-size:18px">🌐</span><span><span style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.6)">Website</span><span style="color:#FFD700;font-weight:700">${esc(designerWebsite.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</span></span></a>` : ""}
  ${designerEmail ? `<a href="mailto:${esc(designerEmail)}" style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:12px;color:white;text-decoration:none"><span style="font-size:18px">✉️</span><span><span style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.6)">Email</span><span style="color:#FFD700;font-weight:700;word-break:break-word">${esc(designerEmail)}</span></span></a>` : ""}
</div>`.trim()
    : "";

  return `${commissionerCard}\n${cta}`;
}

// ── payment categories ──────────────────────────────────────────────
function paymentsHtml(
  cats: Array<Record<string, unknown>>,
  contact: Record<string, unknown>,
): string {
  const venmo = String(contact.venmoHandle ?? "");
  const phone = String(contact.commissionerPhone ?? "");
  const qrUrl = String(contact.venmoQrUrl ?? "");
  const commName = esc(String(contact.commissionerName ?? "the league"));

  const intro = `
<p style="font-size:15px;line-height:1.55;color:#374151;margin-bottom:24px">
  All payments go to the league commissioner. Pick a fee type below for the amount, then send via Zelle or Venmo.
</p>`.trim();

  const list = cats
    .map((c) => {
      const label = esc(String(c.label ?? ""));
      const amount = esc(String(c.amount ?? ""));
      const note = esc(String(c.note ?? ""));
      return `
<div style="background:white;border:1px solid rgba(0,0,0,0.08);border-left:4px solid #002d6e;border-radius:12px;padding:16px 20px;margin-bottom:10px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap">
  <div style="flex:1;min-width:220px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#9ca3af;margin-bottom:4px">Fee</div>
    <div style="font-size:18px;font-weight:900;color:#111;letter-spacing:0.01em;line-height:1.15;margin-bottom:6px">${label}</div>
    <div style="font-size:13px;color:#6b7280;line-height:1.5">${note}</div>
  </div>
  <div style="background:#002d6e;color:#FFD700;font-size:28px;font-weight:900;padding:8px 18px;border-radius:10px;line-height:1;flex-shrink:0">${amount}</div>
</div>`.trim();
    })
    .join("\n");

  const howToPay = `
<div style="background:white;border:1px solid rgba(0,0,0,0.08);border-radius:14px;overflow:hidden;margin-top:28px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
  <div style="background:#002d6e;padding:16px 22px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;color:rgba(255,255,255,0.6);margin-bottom:4px">How to pay</div>
    <div style="font-size:18px;font-weight:900;color:white">Send payment to ${commName}</div>
  </div>
  <div style="padding:6px 22px">
    <div style="display:flex;align-items:center;gap:16px;padding:18px 0;border-bottom:1px solid rgba(0,0,0,0.06)">
      <div style="width:48px;height:48px;border-radius:12px;background:#6c3de0;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">💸</div>
      <div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#9ca3af;margin-bottom:4px">Zelle</div>
        <div style="font-size:16px;font-weight:700;color:#111">${phone ? `<a href="${esc(telHref(phone))}" style="color:#002d6e;text-decoration:none">${esc(phone)}</a>` : "Contact the commissioner"}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:2px">Send to the cell number above</div>
      </div>
    </div>
    ${
      venmo
        ? `
    <div style="padding:18px 0">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:${qrUrl ? "14px" : "0"}">
        <div style="width:48px;height:48px;border-radius:12px;background:#008aff;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">📱</div>
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#9ca3af;margin-bottom:4px">Venmo</div>
          <div style="font-size:16px;font-weight:900;color:#111">${esc(venmo)}</div>
          <div style="font-size:13px;color:#6b7280;margin-top:2px">${commName}</div>
        </div>
      </div>
      ${
        qrUrl
          ? `
      <div style="display:flex;flex-direction:column;align-items:center;background:rgba(0,138,255,0.05);border:1px solid rgba(0,138,255,0.15);border-radius:12px;padding:18px;gap:8px">
        <img src="${esc(qrUrl)}" alt="Venmo QR code" style="width:200px;height:200px;border-radius:10px;background:white;object-fit:contain;display:block" />
        <div style="font-size:12px;color:#6b7280;text-align:center;max-width:280px">Scan with your camera or Venmo app to pay instantly</div>
      </div>`
          : ""
      }
    </div>`
        : ""
    }
  </div>
</div>`.trim();

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
      html: sponsorsHtml(
        sponsorsArr as Array<Record<string, unknown>>,
        contact as Record<string, unknown>,
      ),
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

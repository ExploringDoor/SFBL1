// Pay Online — dedicated route with a dropdown picker. Replaces the
// long flat fee list that used to live in /content/pay-online for
// LBDC. Adam asked for the picker UX on 2026-05-13.
//
// Behaviour:
//   - If site_config/payment_categories.data exists for the tenant,
//     render the rich picker (PayOnlinePicker client component).
//   - Otherwise fall back to the legacy /content/pay-online HTML
//     blob (used by SFBL today). This keeps the old route working
//     for tenants that haven't structured their fees yet.
//
// We don't redirect /content/pay-online → /pay-online — tenants may
// still have inbound links pointing there.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { markdownToHtml } from "@/lib/markdown";
import {
  PayOnlinePicker,
  type PayCategory,
  type PayContact,
} from "@/components/PayOnlinePicker";

export const dynamic = "force-dynamic";

interface PaymentDoc {
  data?: PayCategory[];
}

interface ContactDoc {
  commissionerName?: string;
  commissionerPhone?: string;
  venmoHandle?: string;
  venmoQrUrl?: string;
}

export default async function PayOnlinePage() {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) {
    return (
      <Shell heading="Pay Online">
        <p className="text-slate-700">
          Pay Online is tenant-scoped. Visit a tenant subdomain.
        </p>
      </Shell>
    );
  }

  const db = getAdminDb();
  const [catsSnap, contactSnap, contentSnap] = await Promise.all([
    db.doc(`leagues/${tenantId}/site_config/payment_categories`).get(),
    db.doc(`leagues/${tenantId}/site_config/contact`).get(),
    db.doc(`leagues/${tenantId}/page_content/pay-online`).get(),
  ]);

  const cats =
    catsSnap.exists && Array.isArray((catsSnap.data() as PaymentDoc).data)
      ? ((catsSnap.data() as PaymentDoc).data as PayCategory[])
      : [];

  // Structured path — render the picker.
  if (cats.length > 0) {
    const contact = (contactSnap.exists
      ? (contactSnap.data() as ContactDoc)
      : {}) as PayContact;
    return (
      <Shell heading="Pay Online">
        <PayOnlinePicker categories={cats} contact={contact} />
      </Shell>
    );
  }

  // Fallback — render the existing /content/pay-online HTML blob.
  // This matches the SFBL deployment where the commissioner edits a
  // single page with no fee schema.
  if (contentSnap.exists) {
    const data = contentSnap.data() ?? {};
    const cachedHtml =
      typeof data.html === "string" && data.html ? String(data.html) : "";
    const html = cachedHtml || markdownToHtml(String(data.markdown ?? ""));
    return (
      <Shell heading={String(data.title ?? "Pay Online")}>
        <article
          className="prose prose-slate max-w-none [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_a]:text-blue-600 [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </Shell>
    );
  }

  return (
    <Shell heading="Pay Online">
      <p style={{ color: "var(--muted)" }}>
        Payment information hasn't been published for this league yet.
      </p>
    </Shell>
  );
}

function Shell({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
      </header>
      {children}
    </main>
  );
}

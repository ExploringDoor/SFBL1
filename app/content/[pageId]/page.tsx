// /content/[pageId] — public renderer for any commissioner-managed
// page beyond the canonical ones (which have their own routes:
// /rules, /). Lets the commissioner spin up an "About," "Code of
// Conduct," "Sponsors," etc. without me deploying a new route — they
// create a page_content doc from the admin Pages manager, share the
// URL, done.
//
// Server-rendered. Reads /leagues/{tenantId}/page_content/{pageId}.
// 404s if the doc doesn't exist (don't expose the editor on missing
// pages — the admin creates new pages from /admin, not by visiting
// the URL).
//
// Title is derived from the doc's optional `title` field, falling
// back to a humanized pageId ("about" → "About", "code-of-conduct" →
// "Code Of Conduct").

import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { markdownToHtml } from "@/lib/markdown";
import { PageContentEditor } from "@/components/PageContentEditor";
import {
  ContentSections,
  extractLeadingH1,
} from "@/components/ContentSections";

export const dynamic = "force-dynamic";

interface RouteParams {
  pageId: string;
}

function humanize(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((p) => (p ? p[0]!.toUpperCase() + p.slice(1) : ""))
    .join(" ");
}

// Reserved slugs that have dedicated routes. Block them here so
// /content/rules doesn't shadow /rules.
const RESERVED_SLUGS = new Set([
  "rules",
  "schedule",
  "scores",
  "standings",
  "teams",
  "players",
  "captain",
  "admin",
  "profile",
  "login",
]);

export default async function ContentPage({
  params,
}: {
  params: RouteParams;
}) {
  const pageId = params.pageId;
  if (!/^[a-z0-9_-]+$/.test(pageId)) notFound();
  if (RESERVED_SLUGS.has(pageId)) notFound();

  const h = headers();
  const tenantId = h.get("x-tenant-id");
  if (!tenantId) {
    return (
      <Shell heading="Page">
        <p className="text-slate-700">
          Pages are tenant-scoped. Visit a tenant subdomain.
        </p>
      </Shell>
    );
  }

  const db = getAdminDb();
  const docSnap = await db
    .doc(`leagues/${tenantId}/page_content/${pageId}`)
    .get();
  if (!docSnap.exists) notFound();

  const data = docSnap.data() ?? {};
  const updatedAt = data.updated_at as string | undefined;
  // Prefer the stored `html` field (RichEditor source-of-truth or
  // markdown→html cache). Fall back to re-rendering markdown for
  // pages that haven't been re-saved since the editor was added.
  const cachedHtml =
    typeof data.html === "string" && data.html ? String(data.html) : "";
  const markdown = String(data.markdown ?? "");
  const rawHtml = cachedHtml || markdownToHtml(markdown);

  // The page printed its title twice: once as the route heading and again as
  // the markdown's own leading "# ...". Lift that H1 out and use it as THE
  // title — it is also better copy than the stored `title`, which the seed
  // derives from the slug ("events-clinics" -> "Events-clinics").
  const { title: h1Title, body: html } = extractLeadingH1(rawHtml);
  const title = h1Title ?? String(data.title ?? humanize(pageId));

  return (
    <Shell heading={title}>
      {updatedAt && (
        <p className="mb-4 text-xs text-slate-500">
          Last updated{" "}
          {new Date(updatedAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      )}
      <ContentSections html={html} />
      <PageContentEditor
        tenantId={tenantId}
        pageId={pageId}
        initialMarkdown={markdown}
        editHeading={`Edit ${title} (markdown)`}
      />
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
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
      </header>
      {children}
    </main>
  );
}

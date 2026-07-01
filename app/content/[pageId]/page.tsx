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
  const title = String(data.title ?? humanize(pageId));
  const updatedAt = data.updated_at as string | undefined;
  // Prefer the stored `html` field (RichEditor source-of-truth or
  // markdown→html cache). Fall back to re-rendering markdown for
  // pages that haven't been re-saved since the editor was added.
  const cachedHtml =
    typeof data.html === "string" && data.html ? String(data.html) : "";
  const markdown = String(data.markdown ?? "");
  const html = cachedHtml || markdownToHtml(markdown);

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
      <article
        className="prose prose-slate max-w-none [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_a]:text-blue-600 [&_a]:underline [&_strong]:font-semibold [&_em]:italic [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600 [&_table]:w-full [&_table]:my-4 [&_table]:text-sm [&_th]:text-left [&_th]:font-semibold [&_th]:bg-slate-50 [&_th]:border [&_th]:border-slate-200 [&_th]:px-3 [&_th]:py-2 [&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-2"
        dangerouslySetInnerHTML={{ __html: html }}
      />
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
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
      </header>
      {children}
    </main>
  );
}

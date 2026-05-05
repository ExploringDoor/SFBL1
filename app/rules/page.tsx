import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { markdownToHtml } from "@/lib/markdown";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { PageContentEditor } from "@/components/PageContentEditor";

export const dynamic = "force-dynamic";

const DEFAULT_PLACEHOLDER = `# League Rules

This page hasn't been written yet.

Sign in as a league administrator and click **Edit** to add your league's
rules. Markdown is supported (headings, lists, links, tables, bold/italic).
`;

export default async function RulesPage() {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  const config = (() => {
    const raw = h.get("x-tenant-config-json");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicLeagueConfig;
    } catch {
      return null;
    }
  })();

  if (!tenantId) {
    return (
      <Shell heading="Rules">
        <p className="text-slate-700">
          Rules pages are tenant-scoped. Visit a tenant subdomain.
        </p>
      </Shell>
    );
  }

  const db = getAdminDb();
  const docSnap = await db
    .doc(`leagues/${tenantId}/page_content/rules`)
    .get();
  const markdown =
    (docSnap.exists ? (docSnap.data()?.markdown as string | undefined) : null) ??
    DEFAULT_PLACEHOLDER;
  const html = markdownToHtml(markdown);
  const updatedAt = docSnap.data()?.updated_at as string | undefined;

  return (
    <Shell heading={config?.name ? `${config.name} — Rules` : "Rules"}>
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
        className="prose prose-slate max-w-none [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_a]:text-blue-600 [&_a]:underline [&_strong]:font-semibold [&_em]:italic [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <PageContentEditor
        tenantId={tenantId}
        pageId="rules"
        initialMarkdown={markdown}
        editHeading="Edit rules (markdown)"
      />
    </Shell>
  );
}

function Shell({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
      </header>
      {children}
    </main>
  );
}

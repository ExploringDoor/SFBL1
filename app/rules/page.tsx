import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { markdownToHtml } from "@/lib/markdown";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { PageContentEditor } from "@/components/PageContentEditor";
import { RulesRichView, type RulesSection } from "@/components/RulesRichView";

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
  // Prefer structured rules (site_config/rules.data = array of
  // sections) when present — renders the rich LBDC-style UI with
  // division tabs + per-section cards. Falls back to the freeform
  // page_content/rules HTML path for tenants like SFBL.
  const [structuredSnap, contentSnap] = await Promise.all([
    db.doc(`leagues/${tenantId}/site_config/rules`).get(),
    db.doc(`leagues/${tenantId}/page_content/rules`).get(),
  ]);

  const structuredData = structuredSnap.exists ? structuredSnap.data() : null;
  const sections =
    structuredData && Array.isArray(structuredData.data)
      ? (structuredData.data as RulesSection[]).filter(
          (s) =>
            s &&
            typeof s.section === "string" &&
            Array.isArray(s.items) &&
            s.items.length > 0,
        )
      : [];

  if (sections.length > 0) {
    const hasSat = sections.some(
      (s) => !s.section.toLowerCase().includes("boomers"),
    );
    const hasBom = sections.some((s) =>
      s.section.toLowerCase().includes("boomers"),
    );
    const divisionsAvailable: Array<"saturday" | "boomers"> = [
      ...(hasSat ? (["saturday"] as const) : []),
      ...(hasBom ? (["boomers"] as const) : []),
    ];
    const richUpdatedAt =
      (structuredData?.updated_at as string | undefined) ??
      (contentSnap.data()?.updated_at as string | undefined);
    return (
      <Shell heading={config?.name ? `${config.name} — Rules` : "Rules"}>
        {richUpdatedAt && (
          <p className="mb-4 text-xs text-slate-500">
            Last updated{" "}
            {new Date(richUpdatedAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        )}
        <RulesRichView
          sections={sections}
          divisionsAvailable={divisionsAvailable}
        />
      </Shell>
    );
  }

  // Fallback: page_content/rules HTML path (SFBL today).
  const data = contentSnap.exists ? contentSnap.data() : null;
  const cachedHtml =
    data && typeof data.html === "string" && data.html
      ? String(data.html)
      : "";
  const markdown =
    (data?.markdown as string | undefined) ?? DEFAULT_PLACEHOLDER;
  const html = cachedHtml || markdownToHtml(markdown);
  const updatedAt = data?.updated_at as string | undefined;

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

import * as fs from "node:fs";
import * as path from "node:path";
import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import { markdownToHtml } from "@/lib/markdown";
import type { PublicLeagueConfig } from "@/lib/tenants";
import { PageContentEditor } from "@/components/PageContentEditor";
import {
  ContentSections,
  extractLeadingH1,
} from "@/components/ContentSections";
import {
  RulesRichView,
  type RulesSection,
  type DivisionDef,
} from "@/components/RulesRichView";
import { RulesTabbed, type RulesGroup } from "@/components/RulesTabbed";

// Age-group rule sheets a tenant ships as markdown files (LCYBL publishes one
// per group). When present they drive the tabbed rules view; a tenant without
// them is unaffected.
const RULES_SHEETS: { file: string; label: string }[] = [
  { file: "rules-8u-10u", label: "8U & 10U" },
  { file: "rules-12u-14u", label: "12U & 14U" },
  { file: "rules-fall", label: "Fall Ball" },
];

// Pull the "## At a glance" bullets ("- **Label:** value") out of a sheet into
// {label, value} tiles, and return the markdown with that section removed so it
// isn't repeated in the deep-dive below the tiles.
function extractGlance(md: string): {
  glance: { label: string; value: string }[];
  rest: string;
} {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^##\s+at a glance/i.test(l.trim()));
  if (start === -1) return { glance: [], rest: md };
  let end = start + 1;
  while (end < lines.length && !/^##\s/.test(lines[end]!) && lines[end]!.trim() !== "---") {
    end++;
  }
  const glance: { label: string; value: string }[] = [];
  for (const l of lines.slice(start + 1, end)) {
    const m = /^-\s+\*\*(.+?):\*\*\s*(.+)$/.exec(l.trim());
    if (m) glance.push({ label: m[1]!.trim(), value: m[2]!.trim() });
  }
  // drop the section (and a trailing "---" divider) from the deep dive
  let restEnd = end;
  if (lines[restEnd]?.trim() === "---") restEnd++;
  const rest = [...lines.slice(0, start), ...lines.slice(restEnd)].join("\n");
  return { glance, rest };
}

function loadRulesSheets(tenantId: string): RulesGroup[] {
  const dir = path.resolve(process.cwd(), `data/${tenantId}/pages`);
  const groups: RulesGroup[] = [];
  for (const s of RULES_SHEETS) {
    const p = path.join(dir, `${s.file}.md`);
    if (!fs.existsSync(p)) continue;
    let raw = fs.readFileSync(p, "utf8");
    // strip YAML frontmatter (---\n...\n---)
    const fm = /^---\n[\s\S]*?\n---\n?/;
    raw = raw.replace(fm, "").trim();
    const { glance, rest } = extractGlance(raw);
    // Split the deep-dive into collapsible sections at each "## " heading, so it
    // renders as an accordion (2D Sports style): a clean list of rule rows that
    // each expand on click.
    const blocks = rest.trim().split(/\n(?=##\s)/);
    const sections: { title: string; html: string }[] = [];
    let lead = "";
    for (const b of blocks) {
      const m = /^##\s+([^\n]+)\n?([\s\S]*)$/.exec(b.trim());
      if (m) {
        sections.push({ title: m[1]!.trim(), html: markdownToHtml(m[2]!.trim()) });
      } else if (b.trim()) {
        lead += b.trim() + "\n\n";
      }
    }
    groups.push({
      key: s.file,
      label: s.label,
      glance,
      lead: lead.trim() ? markdownToHtml(lead.trim()) : "",
      sections,
      html: markdownToHtml(rest.trim()),
    });
  }
  return groups;
}

export const dynamic = "force-dynamic";

const DEFAULT_PLACEHOLDER = `# League Rules

This page hasn't been written yet.

Sign in as a league administrator and click **Edit** to add your league's
rules. Markdown is supported (headings, lists, links, tables, bold/italic).
`;

// Page heading. Most tenants prefix the league name ("COYBL — Rules"), which is
// how it has always read. Island does not: its header banner sits directly above
// this line and already carries the league's logo and wordmark, so repeating the
// name there just made a long title for something the art had covered. Adam
// asked for the plain word on 2026-08-02.
function rulesHeading(
  tenantId: string | null,
  config: { name?: string; flags?: { hide_page_titles?: boolean } } | null,
): string {
  if (config?.flags?.hide_page_titles) return "";
  if (tenantId === "island" || !config?.name) return "Rules";
  return `${config.name} — Rules`;
}

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
            // A section is renderable if it has rule items OR, for the
            // at-a-glance strip, spec pairs. The original check demanded
            // items[], which would have silently dropped every specs card.
            ((Array.isArray(s.items) && s.items.length > 0) ||
              (s.kind === "specs" &&
                Array.isArray(s.specs) &&
                s.specs.length > 0)),
        )
      : [];

  // Presence of a top-level `divisions` array selects the generic,
  // data-driven renderer. LBDC has no such field and keeps the legacy
  // title-sniffing path below.
  const divisionDefs =
    structuredData && Array.isArray(structuredData.divisions)
      ? (structuredData.divisions as DivisionDef[]).filter(
          (d) => d && typeof d.key === "string" && typeof d.label === "string",
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
    // `content_updated` is the date the LEAGUE last revised its rules (Island's
    // page is stamped "Updated 1/5/2026"). Prefer it over `updated_at`, which is
    // just when the seed script last wrote the doc and would tell a coach the
    // rules changed today when they did not.
    const richUpdatedAt =
      (structuredData?.content_updated as string | undefined) ??
      (structuredData?.updated_at as string | undefined) ??
      (contentSnap.data()?.updated_at as string | undefined);
    return (
      <Shell
        heading={rulesHeading(tenantId, config)}
        wide={divisionDefs.length > 0}
      >
        {richUpdatedAt && (
          <p className="mb-4 text-xs text-slate-500">
            Last updated{" "}
            {new Date(richUpdatedAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
              timeZone: "UTC",
            })}
          </p>
        )}
        <RulesRichView
          sections={sections}
          divisionsAvailable={divisionsAvailable}
          {...(divisionDefs.length > 0 ? { divisions: divisionDefs } : {})}
        />
      </Shell>
    );
  }

  // Age-group rule sheets shipped as markdown files (LCYBL). Renders a tabbed
  // view, one tab per sheet, each carded by ContentSections. Only taken when the
  // tenant has no structured rules AND ships the files, so others are unchanged.
  const ruleSheets = loadRulesSheets(tenantId);
  if (ruleSheets.length > 0) {
    return (
      <Shell heading={rulesHeading(tenantId, config)} wide>
        <RulesTabbed groups={ruleSheets} updatedAt="March 10, 2026" />
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

  // COYBL keeps all of its rules on one page (League Rules + each age rulebook
  // + tournament, bat, baseballs, field dimensions), each as a top-level ##
  // section. ContentSections renders those as cards with a "Jump To" button
  // row at the top, which is the single-page-with-buttons layout Adam asked
  // for. Other tenants keep the plain prose article, so their rules pages are
  // unchanged.
  const sectioned = tenantId === "coybl";
  const { body: sectionedBody } = sectioned
    ? extractLeadingH1(html)
    : { body: html };

  return (
    <Shell heading={rulesHeading(tenantId, config)}>
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
      {sectioned ? (
        <ContentSections html={sectionedBody} />
      ) : (
        <article
          className="prose prose-slate max-w-none [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_a]:text-blue-600 [&_a]:underline [&_strong]:font-semibold [&_em]:italic [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600 [&_table]:w-full [&_table]:my-4 [&_table]:text-sm [&_th]:text-left [&_th]:font-semibold [&_th]:bg-slate-50 [&_th]:border [&_th]:border-slate-200 [&_th]:px-3 [&_th]:py-2 [&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-2"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
      <PageContentEditor
        tenantId={tenantId}
        pageId="rules"
        initialMarkdown={markdown}
        editHeading="Edit rules (markdown)"
      />
    </Shell>
  );
}

function Shell({
  heading,
  children,
  wide = false,
}: {
  heading: string;
  children: React.ReactNode;
  /** The rich division view carries tabs and a spec grid, which are cramped in
   *  the 3xl prose column. Freeform markdown keeps the narrower measure. */
  wide?: boolean;
}) {
  return (
    <main
      className={`mx-auto px-6 py-12 ${wide ? "max-w-5xl" : "max-w-3xl"}`}
    >
      {heading && (
        <header className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
        </header>
      )}
      {children}
    </main>
  );
}

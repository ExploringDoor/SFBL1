"use client";

import { useState } from "react";
import { useLeagueRole, useUser } from "@/lib/auth-client";
import { markdownToHtml } from "@/lib/markdown";

// Renders an "Edit this page" button only when the signed-in user is
// admin of the current tenant. Click → enter edit mode (textarea +
// live-rendered preview). Save → POST to /api/page-content. Refresh
// the page on success so the public article reflects the new content.
export function EditAffordance({
  tenantId,
  initialMarkdown,
}: {
  tenantId: string;
  initialMarkdown: string;
}) {
  const user = useUser();
  const role = useLeagueRole(tenantId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialMarkdown);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "err"; message: string }
  >({ kind: "idle" });

  if (role !== "admin" || !user) return null;

  if (!editing) {
    return (
      <div className="mt-8 flex justify-end">
        <button
          onClick={() => setEditing(true)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          Edit this page
        </button>
      </div>
    );
  }

  async function save() {
    setStatus({ kind: "saving" });
    try {
      const token = await user!.getIdToken();
      const res = await fetch("/api/page-content", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          leagueId: tenantId,
          pageId: "rules",
          markdown: draft,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      // Page is server-rendered — full reload picks up the new content.
      window.location.reload();
    } catch (err) {
      setStatus({
        kind: "err",
        message: err instanceof Error ? err.message : "Save failed",
      });
    }
  }

  const previewHtml = markdownToHtml(draft);

  return (
    <div className="mt-8 space-y-3 rounded-md border border-slate-300 bg-slate-50 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Edit rules (markdown)</h3>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setEditing(false);
              setDraft(initialMarkdown);
              setStatus({ kind: "idle" });
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={status.kind === "saving"}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {status.kind === "saving" ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-[60vh] w-full rounded-md border border-slate-300 bg-white p-3 font-mono text-sm"
          spellCheck={false}
        />
        <div
          className="prose prose-sm prose-slate max-w-none rounded-md border border-slate-200 bg-white p-3 text-sm overflow-y-auto h-[60vh] [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_p]:my-2 [&_a]:text-blue-600 [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      </div>
      {status.kind === "err" && (
        <p className="text-xs text-red-700">❌ {status.message}</p>
      )}
      <p className="text-xs text-slate-500">
        Markdown supports: <code># Heading</code>, <code>**bold**</code>,{" "}
        <code>*italic*</code>, <code>[text](url)</code>, lists with{" "}
        <code>-</code> or <code>1.</code>, tables, blockquotes with{" "}
        <code>&gt;</code>. HTML is sanitized on save.
      </p>
    </div>
  );
}

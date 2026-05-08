"use client";

// Admin Pages manager — lets the commissioner list / create / edit
// page_content docs without me deploying a new route per page.
// Each doc renders publicly at /content/[pageId] (or /rules for the
// reserved slug).
//
// Listing: reads /leagues/{leagueId}/page_content public collection
// via the client SDK (rules allow public reads). Create flow: takes
// pageId + title + markdown, POSTs /api/page-content. Edit: link to
// the corresponding /content/[pageId] (or /rules) page where the
// existing PageContentEditor button-revealed editor handles it.

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { RichEditor } from "./RichEditor";
import { markdownToHtml } from "@/lib/markdown";

interface PageRow {
  id: string;
  title: string | null;
  updated_at: string | null;
  bytes: number;
}

interface Props {
  leagueId: string;
  user: User;
}

const SLUG_OK = /^[a-z0-9][a-z0-9_-]*$/;

// Pages with dedicated routes — link there instead of /content/[id].
const RESERVED_ROUTES: Record<string, string> = {
  rules: "/rules",
};

export function PagesManager({ leagueId, user }: Props) {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [newId, setNewId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newHtml, setNewHtml] = useState("");
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  // Edit-in-modal state.
  const [editing, setEditing] = useState<{
    pageId: string;
    title: string;
    html: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  async function openEditor(p: PageRow) {
    setSaveMsg(null);
    try {
      const db = getDb();
      const snap = await getDoc(
        doc(db, `leagues/${leagueId}/page_content/${p.id}`),
      );
      const data = snap.exists() ? snap.data() : null;
      // Prefer stored html. Fall back to converting legacy markdown
      // so the editor opens with content even on never-rich-edited
      // pages.
      let html = "";
      if (data && typeof data.html === "string" && data.html) {
        html = data.html;
      } else if (data && typeof data.markdown === "string" && data.markdown) {
        html = markdownToHtml(data.markdown);
      }
      setEditing({
        pageId: p.id,
        title: p.title ?? slugToTitle(p.id),
        html,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load page");
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/page-content", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          pageId: editing.pageId,
          html: editing.html,
          title: editing.title,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setSaveMsg(`Error: ${data.error ?? `HTTP ${res.status}`}`);
        return;
      }
      setSaveMsg("Saved.");
      await load();
      // Auto-close after a beat so admin sees the success state.
      setTimeout(() => {
        setEditing(null);
        setSaveMsg(null);
      }, 600);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const db = getDb();
      const snap = await getDocs(
        collection(db, `leagues/${leagueId}/page_content`),
      );
      setPages(
        snap.docs
          .map((d) => {
            const data = d.data();
            const md = String(data.markdown ?? "");
            return {
              id: d.id,
              title:
                typeof data.title === "string" && data.title
                  ? data.title
                  : null,
              updated_at:
                typeof data.updated_at === "string"
                  ? data.updated_at
                  : null,
              bytes: md.length,
            };
          })
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load pages");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  async function createPage() {
    setCreateMsg(null);
    const id = newId.trim().toLowerCase();
    if (!SLUG_OK.test(id)) {
      setCreateMsg(
        "Page ID must start with a letter or number; only lowercase letters, numbers, - and _ allowed",
      );
      return;
    }
    if (!newHtml.trim() || newHtml === "<p></p>") {
      setCreateMsg("Page content can't be empty");
      return;
    }
    setCreating(true);
    try {
      const idToken = await user.getIdToken();
      // /api/page-content accepts html now (sanitized server-side).
      // Title flows in the same body. New pages skip the legacy
      // markdown path entirely.
      const res = await fetch("/api/page-content", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          pageId: id,
          html: newHtml,
          ...(newTitle.trim() ? { title: newTitle.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setCreateMsg(data.error ?? "Save failed");
        return;
      }
      setNewId("");
      setNewTitle("");
      setNewHtml("");
      setCreateMsg(`Created /content/${id}`);
      await load();
    } catch (e) {
      setCreateMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setCreating(false);
    }
  }

  function urlFor(pageId: string): string {
    return RESERVED_ROUTES[pageId] ?? `/content/${pageId}`;
  }

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <p className="font-semibold text-slate-900">Pages</p>
      <p className="text-xs text-slate-600 leading-relaxed">
        Manage commissioner-edited pages. Use these for rules, code of
        conduct, sponsors, registration info, etc. Public URL is
        /content/&lt;page-id&gt; (or /rules for the reserved slug).
      </p>

      {error && (
        <p className="text-sm text-red-700 rounded bg-red-50 px-2 py-1 border border-red-200">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : pages.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          No pages yet. Create your first below.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 border border-slate-200 rounded-md">
          {pages.map((p) => (
            <li
              key={p.id}
              className="px-3 py-2 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">
                  {p.title ?? p.id}
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {p.updated_at
                    ? `Last updated ${new Date(p.updated_at).toLocaleDateString()}`
                    : "Not yet edited"}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => openEditor(p)}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
                >
                  ✏ Edit
                </button>
                <a
                  href={urlFor(p.id)}
                  target="_blank"
                  rel="noopener"
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  title="View public page"
                >
                  View
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Create form */}
      <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <summary className="text-sm font-semibold text-slate-900 cursor-pointer">
          + New page
        </summary>
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 mb-1">
              Page ID (URL slug)
            </span>
            <input
              type="text"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="about, code-of-conduct, sponsors…"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              disabled={creating}
            />
            <span className="block text-xs text-slate-500 mt-1">
              Lowercase letters, numbers, - and _ only. Public URL becomes
              /content/&lt;this-slug&gt;.
            </span>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 mb-1">
              Display title (optional)
            </span>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder='e.g. "About SFBL", "Sponsors"'
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              disabled={creating}
            />
            <span className="block text-xs text-slate-500 mt-1">
              Defaults to a humanized version of the slug if left blank.
            </span>
          </label>
          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-1">
              Page content
            </span>
            <RichEditor
              initialHtml={newHtml}
              onChange={setNewHtml}
              placeholder="Write your page content here. Use the toolbar above for headings, formatting, links, and images."
              disabled={creating}
            />
          </div>
          <button
            onClick={createPage}
            disabled={
              creating ||
              !newId.trim() ||
              !newHtml.trim() ||
              newHtml === "<p></p>"
            }
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create page"}
          </button>
          {createMsg && (
            <p
              className={
                "text-xs " +
                (createMsg.startsWith("Created")
                  ? "text-emerald-700"
                  : "text-red-700")
              }
            >
              {createMsg}
            </p>
          )}
        </div>
      </details>

      {editing && (
        <PageEditorModal
          pageId={editing.pageId}
          title={editing.title}
          html={editing.html}
          saving={saving}
          message={saveMsg}
          onTitleChange={(t) =>
            setEditing((cur) => (cur ? { ...cur, title: t } : cur))
          }
          onHtmlChange={(h) =>
            setEditing((cur) => (cur ? { ...cur, html: h } : cur))
          }
          onSave={saveEdit}
          onCancel={() => {
            if (
              !saving &&
              window.confirm("Close without saving? Unsaved changes will be lost.")
            ) {
              setEditing(null);
              setSaveMsg(null);
            } else if (saving) {
              // Don't close mid-save.
            }
          }}
        />
      )}
    </section>
  );
}

// "news" → "News"; "code-of-conduct" → "Code Of Conduct".
function slugToTitle(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// ─── Full-screen editor modal ────────────────────────────────────

function PageEditorModal({
  pageId,
  title,
  html,
  saving,
  message,
  onTitleChange,
  onHtmlChange,
  onSave,
  onCancel,
}: {
  pageId: string;
  title: string;
  html: string;
  saving: boolean;
  message: string | null;
  onTitleChange: (t: string) => void;
  onHtmlChange: (h: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  // Lock body scroll while modal is open so the page beneath doesn't
  // scroll under the editor.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[1000] bg-slate-900/60 backdrop-blur-sm flex items-stretch justify-center p-4 sm:p-8 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-5xl bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden my-auto">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <span className="text-xs font-mono text-slate-500 flex-shrink-0">
              /content/{pageId}
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              disabled={saving}
              placeholder="Page title"
              className="flex-1 min-w-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-base font-bold focus:outline-none focus:border-slate-900"
            />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </header>

        {/* Editor */}
        <div className="flex-1 min-h-[60vh]">
          <RichEditor
            initialHtml={html}
            onChange={onHtmlChange}
            disabled={saving}
            placeholder="Start writing your page…"
          />
        </div>

        {message && (
          <div
            className={
              "px-5 py-2 text-sm border-t " +
              (message.startsWith("Error")
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800")
            }
          >
            {message}
          </div>
        )}
      </div>
    </div>
  );
}

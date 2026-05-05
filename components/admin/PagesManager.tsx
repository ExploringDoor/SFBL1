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
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

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
  const [newMd, setNewMd] = useState("");
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

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
    if (!newMd.trim()) {
      setCreateMsg("Page content can't be empty");
      return;
    }
    setCreating(true);
    try {
      const idToken = await user.getIdToken();
      // Store the markdown via the existing endpoint. Title is set
      // separately via a Firestore client-write — the page_content
      // collection is admin-write at the rules level so this works
      // because the user has admin claim.
      const res = await fetch("/api/page-content", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          pageId: id,
          markdown: newMd,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setCreateMsg(data.error ?? "Save failed");
        return;
      }
      // If a title was supplied, write it via the client SDK (admin
      // claim is sufficient at the rules level). The /api/page-content
      // endpoint doesn't accept a title yet — extending it would mean
      // versioning the body schema; this works without that.
      if (newTitle.trim()) {
        const db = getDb();
        const { setDoc, doc } = await import("firebase/firestore");
        await setDoc(
          doc(db, `leagues/${leagueId}/page_content/${id}`),
          { title: newTitle.trim() },
          { merge: true },
        );
      }
      setNewId("");
      setNewTitle("");
      setNewMd("");
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
                <div className="text-xs text-slate-500 font-mono truncate">
                  {urlFor(p.id)} · {p.bytes.toLocaleString()} chars
                  {p.updated_at
                    ? ` · updated ${new Date(p.updated_at).toLocaleDateString()}`
                    : ""}
                </div>
              </div>
              <a
                href={urlFor(p.id)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex-shrink-0"
              >
                Open / Edit
              </a>
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
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 mb-1">
              Markdown
            </span>
            <textarea
              value={newMd}
              onChange={(e) => setNewMd(e.target.value)}
              placeholder={"# Heading\n\nFirst paragraph…"}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              rows={8}
              disabled={creating}
              spellCheck={false}
            />
          </label>
          <button
            onClick={createPage}
            disabled={creating || !newId.trim() || !newMd.trim()}
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
    </section>
  );
}

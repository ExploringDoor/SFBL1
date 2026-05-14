"use client";

// Admin tab for News & Events posts. Commissioner-edits the homepage
// "From the Commissioner" strip. Pattern follows AlertsManager but
// supports multiple posts (full CRUD, not a single doc).
//
// Flow:
//   - Load existing posts via Firestore SDK (read is OK from client
//     for an admin; we don't expose secrets).
//   - Edit/create/pin/delete via /api/admin-news (idToken-auth'd).
//
// Body is HTML (sanitized server-side). Title is plain text. An
// optional event_date (yyyy-mm-dd) flips the public card into "event"
// mode with a calendar icon + date row.

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  collection,
  getDocs,
  orderBy,
  query,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { RichEditor } from "./RichEditor";

interface NewsPost {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  event_date: string | null;
  color: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface Props {
  leagueId: string;
  user: User;
}

const EMPTY: NewsPost = {
  id: "",
  title: "",
  body: "",
  pinned: false,
  event_date: null,
  color: null,
  created_at: null,
  updated_at: null,
};

export function NewsManager({ leagueId, user }: Props) {
  const [posts, setPosts] = useState<NewsPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<NewsPost | null>(null);
  const [busy, setBusy] = useState<null | "save" | "delete">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function refresh() {
    const db = getDb();
    // Order by created_at desc; pin state handled at render time
    // (pinned posts hoisted to the top of the rendered list).
    const snap = await getDocs(
      query(
        collection(db, `leagues/${leagueId}/news`),
        orderBy("created_at", "desc"),
      ),
    );
    const list: NewsPost[] = snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: String(data.id ?? d.id),
        title: String(data.title ?? ""),
        body: String(data.body ?? ""),
        pinned: data.pinned === true,
        event_date: data.event_date ? String(data.event_date) : null,
        color:
          typeof data.color === "string" && /^#[0-9a-f]{6}$/i.test(data.color)
            ? data.color
            : null,
        created_at: data.created_at ? String(data.created_at) : null,
        updated_at: data.updated_at ? String(data.updated_at) : null,
      };
    });
    // Pinned-first, then by created_at desc within each group. The
    // Firestore order-by guaranteed created_at desc globally; we
    // re-sort here for the pin priority.
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const ad = a.created_at ?? "";
      const bd = b.created_at ?? "";
      return bd.localeCompare(ad);
    });
    setPosts(list);
    setLoading(false);
  }

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [leagueId]);

  async function save(post: NewsPost) {
    setBusy("save");
    setMsg(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-news", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          action: "save",
          id: post.id || undefined,
          title: post.title,
          body: post.body,
          pinned: post.pinned,
          event_date: post.event_date,
          color: post.color,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && data.ok) {
        setMsg({ ok: true, text: "Saved." });
        setEditing(null);
        await refresh();
      } else {
        setMsg({ ok: false, text: data.error ?? `HTTP ${res.status}` });
      }
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function del(id: string) {
    if (!confirm("Delete this post? This cannot be undone.")) return;
    setBusy("delete");
    setMsg(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-news", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, action: "delete", id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && data.ok) {
        setMsg({ ok: true, text: "Deleted." });
        await refresh();
      } else {
        setMsg({ ok: false, text: data.error ?? `HTTP ${res.status}` });
      }
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p>Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Posts that appear in the homepage "News & Events" strip. Pin
          to keep at the top. Add a date for events.
        </p>
        <button
          type="button"
          onClick={() => setEditing({ ...EMPTY })}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
        >
          + New post
        </button>
      </div>

      {msg && (
        <div
          className={
            "rounded-md p-3 text-sm " +
            (msg.ok
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700")
          }
        >
          {msg.text}
        </div>
      )}

      {editing && (
        <Editor
          post={editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onChange={setEditing}
          onSave={() => save(editing)}
        />
      )}

      <ul className="space-y-3">
        {posts.length === 0 && (
          <li className="rounded-md border border-dashed border-slate-300 p-6 text-center text-slate-500">
            No posts yet. Click "+ New post" to add the first one.
          </li>
        )}
        {posts.map((p) => (
          <li
            key={p.id}
            className="rounded-md border border-slate-200 bg-white p-4"
            style={{ borderLeft: `4px solid ${p.color ?? "#002d6e"}` }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  {p.pinned && (
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 font-semibold text-orange-700">
                      📌 Pinned
                    </span>
                  )}
                  {p.event_date && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                      📅{" "}
                      {new Date(p.event_date).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  )}
                  {p.updated_at && (
                    <span className="text-slate-400">
                      Updated{" "}
                      {new Date(p.updated_at).toLocaleDateString("en-US")}
                    </span>
                  )}
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  {p.title || <em className="text-slate-400">(untitled)</em>}
                </h3>
                {p.body && (
                  <div
                    className="prose prose-sm mt-1 max-w-none text-slate-700"
                    dangerouslySetInnerHTML={{ __html: p.body }}
                  />
                )}
              </div>
              <div className="flex flex-shrink-0 flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setEditing({ ...p })}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => del(p.id)}
                  disabled={busy !== null}
                  className="rounded-md border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Editor({
  post,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  post: NewsPost;
  busy: null | "save" | "delete";
  onChange: (p: NewsPost) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700">
        {post.id ? "Edit post" : "New post"}
      </h3>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">
            Title
          </label>
          <input
            type="text"
            value={post.title}
            onChange={(e) => onChange({ ...post, title: e.target.value })}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="e.g. 50's Division Players (60+) Invited to Boomers Division!"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-700">
            Body
          </label>
          <RichEditor
            initialHtml={post.body}
            onChange={(html) => onChange({ ...post, body: html })}
            placeholder="What's the announcement?"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={post.pinned}
              onChange={(e) =>
                onChange({ ...post, pinned: e.target.checked })
              }
            />
            Pinned (sticks to top)
          </label>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Event date (optional)
            </label>
            <input
              type="date"
              value={post.event_date ?? ""}
              onChange={(e) =>
                onChange({
                  ...post,
                  event_date: e.target.value || null,
                })
              }
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">
              Accent color (optional)
            </label>
            <input
              type="color"
              value={post.color ?? "#002d6e"}
              onChange={(e) =>
                onChange({ ...post, color: e.target.value || null })
              }
              className="h-9 w-full rounded-md border border-slate-300"
            />
          </div>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy === "save"}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy === "save" ? "Saving…" : post.id ? "Save changes" : "Publish"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

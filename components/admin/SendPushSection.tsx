"use client";

// Admin "Send Push Notification" form — verbatim port of DVSL
// admin.html:8656-8687 (`sendPushNotification`). The commissioner
// composes a title/body, picks a category, optionally narrows by
// team, and the send-notification endpoint fans out per the 9-step
// filter chain.
//
// Wired-in DVSL fixes:
//   - v269: when image is attached and URL is blank, default URL is
//     `/profile#notif` (the embedded inbox in the player/captain
//     portal). Today we don't have image-upload UI yet — the field is
//     stubbed with a TODO so the v269 behaviour lands automatically
//     when image upload arrives.
//   - v272: auto-derive default URL from category. DVSL admin form
//     left the URL blank by default (which FCM treats as no deep
//     link, useless). We pre-fill a sensible default per category so
//     the commissioner doesn't have to remember.
//
// Auto-behaviours:
//   - category === 'admin' → adminOnly: true (server-side filter
//     gates by is_admin, bypasses category prefs). Matches DVSL line
//     8682 (`adminOnly: category === 'admin' || undefined`).
//   - URL field empty → use category default
//
// Authority: requires `admin` claim on the active league. The
// /api/send-notification endpoint also re-verifies; this is just the
// UI gate so non-admins don't see the form.

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import {
  ALL_CATEGORIES,
  CATEGORY_LABELS,
  type NotificationCategory,
} from "@/lib/notifications/categories";

interface TeamOpt {
  id: string;
  name: string;
}

interface SendResult {
  ok: boolean;
  sent?: number;
  failed?: number;
  total?: number;
  pruned?: number;
  error?: string;
}

// v272 — category-keyed URL defaults. Keep in sync with the deep-link
// destinations of DVSL spec §5 trigger payloads. When image-upload
// lands and the user attaches one, this map is overridden by
// `/profile#notif` per v269.
const CATEGORY_DEFAULT_URL: Record<NotificationCategory, string> = {
  scores: "/scores",
  rainouts: "/schedule",
  schedule: "/schedule",
  playoffs: "/standings", // no /playoffs route yet; standings is the closest
  team_chat: "/captain#teamchat",
  captains_chat: "/captain#captchat",
  announcements: "/",
  photos: "/", // no photo gallery route yet
  admin: "/admin",
  live: "/scores",
  pregame: "/schedule",
};

interface Props {
  leagueId: string;
  user: User;
}

export function SendPushSection({ leagueId, user }: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] =
    useState<NotificationCategory>("announcements");
  const [teamId, setTeamId] = useState<string>("");
  const [url, setUrl] = useState<string>("");
  const [teamOptions, setTeamOptions] = useState<TeamOpt[]>([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  // Load teams list once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = getDb();
      const snap = await getDocs(collection(db, `leagues/${leagueId}/teams`));
      if (cancelled) return;
      setTeamOptions(
        snap.docs
          .map((d) => ({ id: d.id, name: String(d.data().name ?? d.id) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  // Effective URL — what we'll actually send. Empty input → category
  // default. (v269 image-attached → /profile#notif override would
  // happen here when image upload is built.)
  const effectiveUrl = useMemo(() => {
    if (url.trim()) return url.trim();
    return CATEGORY_DEFAULT_URL[category];
  }, [url, category]);

  // adminOnly auto-flag (DVSL admin.html:8682).
  const adminOnly = category === "admin";

  async function send() {
    if (!title.trim() || !body.trim()) {
      setResult({ ok: false, error: "Title and body are required" });
      return;
    }
    const audienceLabel = teamId
      ? `${teamOptions.find((t) => t.id === teamId)?.name ?? teamId} subscribers`
      : "ALL subscribers";
    if (
      !window.confirm(
        `Send push "${title}" to ${audienceLabel}?` +
          (adminOnly ? "\n\n(admin-only — only admin recipients receive)" : ""),
      )
    ) {
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/send-notification", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          title: title.trim(),
          body: body.trim(),
          category,
          ...(teamId ? { team: teamId } : {}),
          url: effectiveUrl,
          ...(adminOnly ? { adminOnly: true } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as SendResult & {
        error?: string;
      };
      if (!res.ok) {
        setResult({ ok: false, error: data.error ?? `HTTP ${res.status}` });
      } else {
        setResult({
          ok: true,
          sent: data.sent ?? 0,
          failed: data.failed ?? 0,
          total: data.total ?? 0,
          pruned: data.pruned ?? 0,
        });
        // Clear the form on successful send so the commissioner
        // doesn't accidentally double-send.
        setTitle("");
        setBody("");
        setUrl("");
      }
    } catch (e) {
      setResult({
        ok: false,
        error: e instanceof Error ? e.message : "Send failed",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div>
        <p className="font-semibold text-slate-900">Send push notification</p>
        <p className="text-xs text-slate-600 mt-1 leading-relaxed">
          Send a push to subscribers in this league.{" "}
          <strong>League-wide announcement?</strong> Set Category to{" "}
          <em>Announcements</em>, leave Team blank, write your message, hit
          Send. Goes to everyone subscribed.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Title
          </span>
          <input
            type="text"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={title}
            disabled={sending}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Week 5 standings posted"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Category
          </span>
          <select
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={category}
            disabled={sending}
            onChange={(e) =>
              setCategory(e.target.value as NotificationCategory)
            }
          >
            {ALL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
                {c === "admin" ? " (admin-only)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="block text-xs font-semibold text-slate-700 mb-1">
          Body
        </span>
        <textarea
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          rows={3}
          value={body}
          disabled={sending}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What you want recipients to see when the push lands."
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Team (optional)
          </span>
          <select
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={teamId}
            disabled={sending}
            onChange={(e) => setTeamId(e.target.value)}
          >
            <option value="">All teams (no team filter)</option>
            {teamOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Link (where tapping the push goes)
          </span>
          <input
            type="text"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={url}
            disabled={sending}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={`Default for ${CATEGORY_LABELS[category]}: ${CATEGORY_DEFAULT_URL[category]}`}
          />
        </label>
      </div>

      {/*
       * TODO: image upload field (DVSL `imageDataUrl`). When wired,
       * v269 behaviour kicks in: empty URL + image attached →
       * `/profile#notif` instead of category default.
       */}

      <div className="flex items-center justify-between">
        <button
          onClick={send}
          disabled={sending || !title.trim() || !body.trim()}
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send push"}
        </button>
        {adminOnly && (
          <span className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200">
            admin-only mode
          </span>
        )}
      </div>

      {result && (
        <div
          className={
            result.ok
              ? "text-sm rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800"
              : "text-sm rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800"
          }
        >
          {result.ok ? (
            <>
              ✓ Sent to <strong>{result.sent}</strong>{" "}
              device{result.sent === 1 ? "" : "s"}
              {result.failed
                ? ` (${result.failed} failed`
                : ""}
              {result.failed && result.pruned
                ? `, ${result.pruned} dead tokens pruned)`
                : result.failed
                  ? ")"
                  : ""}
              {result.total === 0 && (
                <span className="block text-xs text-slate-600 mt-1">
                  No matching subscribers — make sure people have enabled
                  notifications and subscribed to this category.
                </span>
              )}
            </>
          ) : (
            <>✗ {result.error}</>
          )}
        </div>
      )}
    </section>
  );
}

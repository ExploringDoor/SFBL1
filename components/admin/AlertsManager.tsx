"use client";

// Admin tab for the homepage banner alert. Pattern follows DVSL
// admin.html:6880 — one active banner at a time, replacing the
// previous when published.
//
// Layout:
//   - Live preview at the top
//   - Title + body (markdown supported), kind selector (info/warning/critical),
//     optional expiration
//   - Publish / Clear buttons

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { RichEditor } from "./RichEditor";

interface BannerState {
  active: boolean;
  title: string;
  body: string;
  kind: "info" | "warning" | "critical";
  expires_at: string | null;
  created_at: string | null;
}

interface Props {
  leagueId: string;
  user: User;
}

const DEFAULT: BannerState = {
  active: false,
  title: "",
  body: "",
  kind: "info",
  expires_at: null,
  created_at: null,
};

export function AlertsManager({ leagueId, user }: Props) {
  const [state, setState] = useState<BannerState>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "publish" | "clear">(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(
    null,
  );

  // Load current banner so admin sees what's currently live and can
  // edit it in place rather than always typing from scratch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = getDb();
        const snap = await getDoc(
          doc(db, `leagues/${leagueId}/site_config/banner`),
        );
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data() as Record<string, unknown>;
          setState({
            active: data.active === true,
            title: String(data.title ?? ""),
            body: String(data.body ?? ""),
            kind:
              data.kind === "warning" || data.kind === "critical"
                ? data.kind
                : "info",
            expires_at: data.expires_at ? String(data.expires_at) : null,
            created_at: data.created_at ? String(data.created_at) : null,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  async function call(
    action: "publish" | "clear",
    extra: Record<string, unknown> = {},
  ) {
    setBusy(action);
    setResult(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-alert", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, action, ...extra }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setResult({ ok: false, msg: data.error ?? `HTTP ${res.status}` });
        return;
      }
      if (action === "clear") {
        setState({ ...state, active: false });
        setResult({ ok: true, msg: "Banner cleared. Homepage hides it now." });
      } else {
        setResult({ ok: true, msg: "Banner is live on the homepage." });
        setState({ ...state, active: true });
      }
    } catch (e) {
      setResult({
        ok: false,
        msg: e instanceof Error ? e.message : "Failed",
      });
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <p className="font-semibold text-slate-900">Banner alert</p>
        <p className="text-sm text-slate-500 mt-2">Loading…</p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-md border border-slate-200 bg-white p-5">
      <div>
        <p className="text-lg font-bold text-slate-900">Homepage banner</p>
        <p className="text-sm text-slate-600 mt-1">
          A short alert shown across the top of the homepage. Use for
          weather updates, registration deadlines, championship-day
          reminders, etc. One banner at a time — publishing replaces
          the previous one.
        </p>
      </div>

      {/* Live preview */}
      <div>
        <span className="block text-xs font-semibold text-slate-700 mb-1.5">
          Preview
        </span>
        <BannerPreview {...state} />
        {!state.active && (
          <p className="text-xs text-slate-500 mt-1 italic">
            Currently inactive — homepage shows nothing.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block sm:col-span-2">
          <span className="block text-sm font-semibold text-slate-800 mb-1.5">
            Title
          </span>
          <input
            type="text"
            value={state.title}
            onChange={(e) => setState({ ...state, title: e.target.value })}
            disabled={busy !== null}
            placeholder="Games rained out today"
            maxLength={120}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-semibold text-slate-800 mb-1.5">
            Type
          </span>
          <select
            value={state.kind}
            onChange={(e) =>
              setState({
                ...state,
                kind: e.target.value as BannerState["kind"],
              })
            }
            disabled={busy !== null}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="info">Info (blue)</option>
            <option value="warning">Warning (amber)</option>
            <option value="critical">Critical (red)</option>
          </select>
        </label>
      </div>

      <div>
        <span className="block text-sm font-semibold text-slate-800 mb-1.5">
          Body (optional)
        </span>
        <RichEditor
          initialHtml={state.body}
          onChange={(html) => setState({ ...state, body: html })}
          placeholder="Make-up dates TBD. Check the schedule for updates."
          disabled={busy !== null}
        />
      </div>

      <label className="block">
        <span className="block text-sm font-semibold text-slate-800 mb-1.5">
          Auto-clear after (optional)
        </span>
        <input
          type="datetime-local"
          value={
            state.expires_at
              ? new Date(state.expires_at).toISOString().slice(0, 16)
              : ""
          }
          onChange={(e) =>
            setState({
              ...state,
              expires_at: e.target.value
                ? new Date(e.target.value).toISOString()
                : null,
            })
          }
          disabled={busy !== null}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <span className="block text-xs text-slate-500 mt-1">
          Banner hides itself after this time. Leave blank to keep it up
          until you clear it manually.
        </span>
      </label>

      <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={() =>
            call("publish", {
              title: state.title,
              body: state.body,
              kind: state.kind,
              expires_at: state.expires_at,
            })
          }
          disabled={busy !== null || (!state.title && !state.body)}
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy === "publish" ? "Publishing…" : "📢 Publish"}
        </button>
        {state.active && (
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "Clear the banner? The homepage will stop showing it.",
                )
              ) {
                call("clear");
              }
            }}
            disabled={busy !== null}
            className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {busy === "clear" ? "Clearing…" : "✕ Clear banner"}
          </button>
        )}
      </div>

      {result && (
        <div
          className={
            "text-sm rounded-md px-3 py-2 " +
            (result.ok
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border border-red-200 bg-red-50 text-red-800")
          }
        >
          {result.ok ? "✓ " : "✗ "}
          {result.msg}
        </div>
      )}
    </section>
  );
}

function BannerPreview({
  title,
  body,
  kind,
}: Pick<BannerState, "title" | "body" | "kind">) {
  const palette: Record<BannerState["kind"], string> = {
    info: "bg-blue-100 border-blue-300 text-blue-900",
    warning: "bg-amber-100 border-amber-300 text-amber-900",
    critical: "bg-red-100 border-red-400 text-red-900",
  };
  if (!title && !body) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-400 italic">
        Banner preview will appear here.
      </div>
    );
  }
  return (
    <div
      className={
        "rounded-md border-2 px-4 py-3 text-sm " + palette[kind]
      }
    >
      {title && <strong className="font-bold">{title}</strong>}
      {title && body && " — "}
      {body && <span>{body}</span>}
    </div>
  );
}

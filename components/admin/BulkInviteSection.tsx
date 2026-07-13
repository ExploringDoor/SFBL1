"use client";

// Admin Bulk Invite — generate sign-in links + grant captain claims
// for many captains in one shot. Lives inside the Captains admin tab.
//
// Flow:
//   1. Admin pastes a list of `email,team_id` lines (one per row).
//   2. Click "Generate invite links" → POSTs all rows to
//      /api/admin-bulk-invite.
//   3. Endpoint creates Firebase Auth users (or finds existing),
//      grants `captain:<team_id>` claim, mints a magic link.
//   4. Results table shows ✓/✗ per row with copy-to-clipboard
//      buttons and a "Copy all as email-friendly text" action.

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useTenant } from "@/lib/tenant-context";
import { captainNoun } from "@/lib/tenants";

interface TeamLite {
  id: string;
  name: string;
}

interface ResultRow {
  email: string;
  teamId: string;
  status: "ok" | "error";
  magicLink?: string;
  error?: string;
}

interface Props {
  leagueId: string;
  user: User;
}

export function BulkInviteSection({ leagueId, user }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamLite[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const { config } = useTenant();
  const captain = captainNoun(config);

  // Load teams for the dropdown helper that suggests team_ids.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = getDb();
      const snap = await getDocs(collection(db, `leagues/${leagueId}/teams`));
      if (cancelled) return;
      setTeams(
        snap.docs
          .map((d) => ({ id: d.id, name: String(d.data().name ?? d.id) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  // Parse the textarea on the fly so we can show row count + show a
  // preview of what'll be submitted.
  const parsed = useMemo(() => {
    const out: { email: string; teamId: string; line: number }[] = [];
    const errs: string[] = [];
    text.split(/\r?\n/).forEach((raw, i) => {
      // Strip trailing "# comment" added by the "Pre-fill rows for
      // every team" helper so it doesn't show up as part of the
      // team_id slug.
      const noComment = raw.replace(/#.*$/, "");
      const trimmed = noComment.trim();
      if (!trimmed) return;
      // A row that's just ",team_id" (admin hasn't filled in the
      // email yet) shouldn't count as a parse error — it's an
      // in-progress row from the pre-fill helper. Skip silently.
      if (trimmed.startsWith(",")) return;
      // Allow `email,team_id` OR `email | team_id` OR tabs.
      const parts = trimmed.split(/\s*[,|\t]\s*/);
      if (parts.length < 2 || !parts[0] || !parts[1]) {
        errs.push(`Line ${i + 1}: needs two columns (email, team_id)`);
        return;
      }
      const [email, teamId] = parts;
      out.push({
        email: email!.toLowerCase(),
        teamId: teamId!,
        line: i + 1,
      });
    });
    return { rows: out, errs };
  }, [text]);

  async function send() {
    setBusy(true);
    setErrorMsg(null);
    setResults(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-bulk-invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          invites: parsed.rows.map((r) => ({
            email: r.email,
            teamId: r.teamId,
          })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        results?: ResultRow[];
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setResults(data.results ?? []);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function copyToClipboard(value: string, key: string) {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);
    });
  }

  function copyAllAsEmail() {
    if (!results) return;
    const lines = results
      .filter((r) => r.status === "ok" && r.magicLink)
      .map(
        (r) =>
          `${r.email}\n` +
          `Sign-in link (one-time, expires in 1h): ${r.magicLink}\n`,
      );
    copyToClipboard(lines.join("\n"), "all");
  }

  const okCount = results
    ? results.filter((r) => r.status === "ok").length
    : 0;
  const errCount = results
    ? results.filter((r) => r.status === "error").length
    : 0;

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 space-y-3">
      <div>
        <p className="font-semibold text-slate-900">Bulk invite {captain}s</p>
        <p className="text-xs text-slate-600 leading-relaxed mt-1">
          Generate magic-link sign-ins + {captain} claims for many {captain}s
          at once. Paste one {captain} per line as{" "}
          <code className="bg-slate-100 px-1 py-0.5 rounded">email,team_id</code>.
          You'll get a list of sign-in links to email out (or paste into
          your own mail merge).
        </p>
      </div>

      <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <summary className="text-xs font-semibold text-slate-700 cursor-pointer">
          Available team_ids ({teams.length})
        </summary>
        <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {teams.map((t) => (
            <li key={t.id}>
              <code className="text-slate-700">{t.id}</code>{" "}
              <span className="text-slate-500">{t.name}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              // Pre-fills one ",<team_id>" row per team. Saves the
              // admin from typing 8-10 team slugs by hand — they just
              // tab to the start of each line and type the email.
              const lines = teams
                .map((t) => `,${t.id}  # ${t.name}`)
                .join("\n");
              setText((prev) =>
                prev.trim() ? prev.trimEnd() + "\n" + lines : lines,
              );
            }}
            disabled={teams.length === 0}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            + Pre-fill rows for every team
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500 leading-snug">
          The "# Team Name" suffix is just a hint — the parser
          ignores everything after a `#`. Type the {captain}'s email
          before each comma.
        </p>
      </details>

      <label className="block">
        <span className="block text-xs font-semibold text-slate-700 mb-1">
          {captain}s to invite
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          disabled={busy}
          spellCheck={false}
          placeholder={`captain1@example.com,margate-marlins\ncaptain2@example.com,broward-yankees\n…`}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs font-mono"
        />
        <span className="block text-xs text-slate-500 mt-1">
          {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"}{" "}
          parsed
          {parsed.errs.length > 0
            ? ` · ${parsed.errs.length} parse error${parsed.errs.length === 1 ? "" : "s"}`
            : ""}
        </span>
      </label>

      {parsed.errs.length > 0 && (
        <ul className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 space-y-1">
          {parsed.errs.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={send}
          disabled={busy || parsed.rows.length === 0}
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy
            ? "Generating…"
            : `Generate ${parsed.rows.length || ""} invite link${parsed.rows.length === 1 ? "" : "s"}`}
        </button>
        {results && results.length > 0 && (
          <button
            type="button"
            onClick={copyAllAsEmail}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {copiedKey === "all"
              ? "✓ Copied"
              : "📋 Copy all as email-friendly text"}
          </button>
        )}
      </div>

      {errorMsg && (
        <p className="text-sm text-red-700 rounded bg-red-50 px-2 py-1 border border-red-200">
          ✗ {errorMsg}
        </p>
      )}

      {results && (
        <div className="space-y-2">
          <p className="text-xs text-slate-600">
            <strong>{okCount}</strong> ok ·{" "}
            <strong>{errCount}</strong> failed
          </p>
          <ul className="divide-y divide-slate-200 border border-slate-200 rounded-md overflow-hidden">
            {results.map((r, i) => {
              const teamName =
                teams.find((t) => t.id === r.teamId)?.name ?? r.teamId;
              return (
                <li
                  key={i}
                  className={
                    "px-3 py-2 text-xs flex items-center gap-3 flex-wrap " +
                    (r.status === "error" ? "bg-red-50/50" : "")
                  }
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900">
                      {r.email}
                    </div>
                    <div className="text-slate-500 text-[11px]">
                      {teamName}
                      {r.status === "error" ? (
                        <span className="text-red-700"> · ✗ {r.error}</span>
                      ) : (
                        <span className="text-emerald-700"> · ✓ link ready</span>
                      )}
                    </div>
                  </div>
                  {r.status === "ok" && r.magicLink && (
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(r.magicLink!, `link-${i}`)
                      }
                      className="rounded-md bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white"
                    >
                      {copiedKey === `link-${i}`
                        ? "✓ Copied"
                        : "Copy link"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

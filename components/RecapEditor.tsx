"use client";

// Inline recap override editor. Visible only to admin or one of the
// captains in the game. Markdown editor + live preview + save/clear/cancel.
//
// Renders a small "Edit recap" button above the recap body. Click
// expands a textarea + preview side-by-side. Save POSTs to
// /api/game-recap; on success, page reloads so the server-rendered
// recap reflects the override. "Clear" removes the override and
// reverts to the auto-generated text.

import { useState } from "react";
import { useUser, useLeagueRole } from "@/lib/auth-client";
import { markdownToHtml } from "@/lib/markdown";

interface Props {
  leagueId: string;
  gameId: string;
  homeTeamId: string;
  awayTeamId: string;
  initialMarkdown: string | null;
  // Captain claim is captain:<team_id> — we extract team_id from
  // useLeagueRole. To know if the captain plays in this game we check
  // their team against home/away. Server reverifies on every write.
}

export function RecapEditor({
  leagueId,
  gameId,
  homeTeamId,
  awayTeamId,
  initialMarkdown,
}: Props) {
  const user = useUser();
  const role = useLeagueRole(leagueId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialMarkdown ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determine if this user can edit. Admin always; captain only if
  // their team plays in this game. We can't know the captain's team
  // from useLeagueRole (returns "captain" not the team id) without
  // peeking at the token claim ourselves — useUser → idTokenResult.
  // For UX we show the button optimistically when role === "captain"
  // and let the server reject if they're a captain of a different
  // team. Wrong-team captains will see an error toast and the button
  // will disappear next page load (server returns 403; we don't
  // pre-resolve here for simplicity).
  if (role !== "admin" && role !== "captain") return null;
  if (!user) return null;
  // Suppress unused-var warning; homeTeamId/awayTeamId are passed
  // for future client-side gating but server-side check is the
  // authoritative gate.
  void homeTeamId;
  void awayTeamId;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const idToken = await user!.getIdToken();
      const res = await fetch("/api/game-recap", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, gameId, markdown: draft }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function clearOverride() {
    if (
      !window.confirm(
        "Revert to the auto-generated recap? Your custom recap will be deleted.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const idToken = await user!.getIdToken();
      const res = await fetch("/api/game-recap", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, gameId, clear: true }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="recap-editor-toolbar">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="recap-edit-btn"
        >
          ✏️ {initialMarkdown ? "Edit recap" : "Write a custom recap"}
        </button>
        {initialMarkdown && (
          <button
            type="button"
            onClick={clearOverride}
            disabled={busy}
            className="recap-clear-btn"
          >
            Revert to auto
          </button>
        )}
      </div>
    );
  }

  const previewHtml = markdownToHtml(draft);

  return (
    <div className="recap-editor">
      <div className="recap-editor-head">
        <strong>Edit recap (markdown)</strong>
        <div className="recap-editor-actions">
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setDraft(initialMarkdown ?? "");
              setError(null);
            }}
            className="recap-clear-btn"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="recap-save-btn"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <div className="recap-editor-grid">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            "# Headline\n\nFirst paragraph of your recap…\n\n**Player of the game:** Aaron Judge — 3-for-4, 2 HR, 5 RBI."
          }
          className="recap-editor-textarea"
          spellCheck
        />
        <div
          className="recap-editor-preview"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      </div>
      {error && <p className="recap-editor-error">{error}</p>}
      <p className="recap-editor-hint">
        Markdown supported: <code>**bold**</code>, <code>*italic*</code>,{" "}
        <code># Heading</code>, <code>- list</code>, <code>[link](url)</code>.
        HTML is sanitized on save. 8KB max.
      </p>
    </div>
  );
}

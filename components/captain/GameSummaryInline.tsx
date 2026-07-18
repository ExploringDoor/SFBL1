"use client";

// Manager-written game summary (recap override) for a single game.
//
// One editor, two entry points (Nelson, 2026-07 — "managers can write a
// little summary of the game afterwards"):
//   1. right after a Quick Score saves (QuickScoreInline), and
//   2. any time later, from the Summary button on a game row in the
//      Submit Score tab — because a manager who already entered the
//      score days ago still needs a way in.
//
// Writes go through /api/game-recap, which re-checks that the caller is a
// captain playing in THIS game (or an admin) and sanitizes the markdown.
// The public game page then renders this instead of the auto-generated
// "Team X defeated Team Y" recap.
//
// Any existing summary is loaded first (recaps are world-readable per
// firestore.rules) so this edits rather than silently clobbers.

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useUser } from "@/lib/auth-client";

// /api/game-recap rejects markdown over 8KB; stay well under it so a
// manager never types their way into a server error.
const SUMMARY_MAX = 4000;

export function GameSummaryInline({
  leagueId,
  gameId,
  oppName,
  onClose,
}: {
  leagueId: string;
  gameId: string;
  oppName: string;
  onClose?: () => void;
}) {
  const user = useUser();
  const [text, setText] = useState("");
  const [hadExisting, setHadExisting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [posted, setPosted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const snap = await getDoc(
          doc(getDb(), `leagues/${leagueId}/recaps/${gameId}`),
        );
        if (!alive) return;
        const md = snap.exists() ? String(snap.data()?.markdown ?? "") : "";
        if (md) {
          setText(md);
          setHadExisting(true);
        }
      } catch {
        // Non-fatal — just start from an empty box.
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leagueId, gameId]);

  async function post() {
    if (!user) {
      setError("Not signed in.");
      return;
    }
    const body = text.trim();
    if (!body) {
      setError("Write a few words first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/game-recap", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, gameId, markdown: body }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setPosted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't post the summary");
    } finally {
      setSaving(false);
    }
  }

  if (posted) {
    return (
      <p
        style={{
          margin: "12px 0 0",
          fontSize: 13.5,
          fontWeight: 600,
          color: "#15803d",
        }}
      >
        ✓ Summary {hadExisting ? "updated" : "posted"} — it&apos;s on the game
        page now.
      </p>
    );
  }

  return (
    <div>
      <div
        style={{ fontSize: 13, fontWeight: 700, color: "var(--text-strong)" }}
      >
        {hadExisting ? "Edit game summary" : "Add a game summary"}{" "}
        <span style={{ fontWeight: 500, color: "var(--muted)" }}>
          (optional)
        </span>
      </div>
      <p
        style={{
          margin: "3px 0 8px",
          fontSize: 12.5,
          lineHeight: 1.5,
          color: "var(--muted)",
        }}
      >
        A few lines on how it went — big hits, who pitched, the turning point.
        It shows on the game page in place of the auto-written recap.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, SUMMARY_MAX))}
        disabled={saving || loading}
        rows={4}
        placeholder={
          loading ? "Loading…" : `How did it go vs ${oppName}?`
        }
        style={{
          width: "100%",
          padding: "9px 11px",
          border: "1px solid rgba(0,0,0,0.2)",
          borderRadius: 8,
          fontSize: 14,
          lineHeight: 1.5,
          fontFamily: "inherit",
          resize: "vertical",
          opacity: loading ? 0.6 : 1,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "var(--muted)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {text.length}/{SUMMARY_MAX}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="le-cap-btn-secondary"
            style={{ marginLeft: "auto" }}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={post}
          disabled={saving || loading || !text.trim()}
          className="le-cap-btn-primary"
          style={{
            marginLeft: onClose ? undefined : "auto",
            opacity: saving || loading || !text.trim() ? 0.6 : 1,
          }}
        >
          {saving
            ? "Posting…"
            : hadExisting
              ? "Update summary"
              : "Post summary"}
        </button>
      </div>
      {error && (
        <div
          style={{
            marginTop: 8,
            fontSize: 13,
            color: "#b91c1c",
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

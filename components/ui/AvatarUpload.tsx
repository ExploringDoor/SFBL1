"use client";

// Floating "✏" button overlaid on the player avatar that opens a
// file picker. Visible only when the signed-in user can edit this
// player's profile (admin / captain-of-team / self-player).
//
// Reads the existing photo via prop (server-rendered initial value)
// and replaces it after a successful upload by setting state on
// the wrapping figure. Falls back to a `window.location.reload()`
// after upload success so the new image flows through the rest of
// the page (team page roster strip, etc.) without us hand-wiring
// every consumer.

import { useEffect, useState } from "react";
import { useUser, useLeagueRole, useCaptainTeam } from "@/lib/auth-client";
import { doc, getDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface Props {
  leagueId: string;
  playerId: string;
  teamId: string;
  /** Current photo URL/data URL — used to render a "remove photo"
   *  affordance only when there's something to remove. */
  initialPhotoUrl: string | null;
}

export function AvatarUpload({
  leagueId,
  playerId,
  teamId,
  initialPhotoUrl,
}: Props) {
  const user = useUser();
  const role = useLeagueRole(leagueId);
  const { teamId: captainTeamId } = useCaptainTeam(leagueId);
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(!!initialPhotoUrl);
  const [error, setError] = useState<string | null>(null);

  // Compute authorization once role + captainTeamId resolve. Player-
  // self check requires reading the player's auth_uid (which links
  // back to the signed-in user), so we look it up once.
  useEffect(() => {
    if (!user || user === undefined) return;
    if (role === "admin") {
      setAuthorized(true);
      return;
    }
    if (captainTeamId === teamId) {
      setAuthorized(true);
      return;
    }
    // Last-resort: self-player check via auth_uid → playerId.
    (async () => {
      try {
        const snap = await getDoc(
          doc(getDb(), `leagues/${leagueId}/players/${playerId}`),
        );
        if (snap.exists()) {
          const data = snap.data();
          if (data.auth_uid === user.uid) setAuthorized(true);
        }
      } catch {
        /* ignore — leave unauthorized */
      }
    })();
  }, [user, role, captainTeamId, teamId, leagueId, playerId]);

  if (!authorized) return null;

  async function handleFile(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Pick an image (PNG / JPG / HEIC).");
      return;
    }
    if (file.size > 5_000_000) {
      setError(
        `That photo is ${(file.size / 1024 / 1024).toFixed(1)} MB. iPhones save big — try Settings → Camera → Formats → "Most Compatible" before retaking.`,
      );
      return;
    }

    setBusy(true);
    try {
      // Resize / re-encode in the browser before uploading. Avatars
      // render at most 120px so 480px is plenty (2× DPR). Saves the
      // user's data plan + keeps the Firestore doc small.
      const dataUrl = await resizeAsDataUrl(file, 480, 0.85);
      const idToken = await user!.getIdToken();
      const res = await fetch("/api/player-avatar", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          playerId,
          imageDataUrl: dataUrl,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setHasPhoto(true);
      // Reload so the new image flows through everywhere on the
      // page (team page roster strip, etc.). Cheaper than wiring
      // up a context.
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!user) return;
    if (!window.confirm("Remove your profile photo?")) return;
    setBusy(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/player-avatar", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          playerId,
          action: "remove",
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setHasPhoto(false);
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="le-avatar-edit">
      <label className="le-avatar-edit-btn" title="Upload profile photo">
        {busy ? "…" : "✎"}
        <input
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.currentTarget.value = "";
          }}
          disabled={busy}
        />
      </label>
      {hasPhoto && (
        <button
          type="button"
          className="le-avatar-edit-remove"
          onClick={handleRemove}
          disabled={busy}
          title="Remove profile photo"
        >
          ×
        </button>
      )}
      {error && (
        <div role="alert" className="le-avatar-edit-err">
          {error}
        </div>
      )}
      <style jsx>{`
        .le-avatar-edit {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .le-avatar-edit-btn,
        .le-avatar-edit-remove {
          position: absolute;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: var(--brand-primary, #002d72);
          color: white;
          border: 3px solid white;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 16px;
          font-weight: 700;
          font-family: inherit;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
          pointer-events: auto;
          transition: filter 0.15s, transform 0.05s;
        }
        .le-avatar-edit-btn:hover,
        .le-avatar-edit-remove:hover {
          filter: brightness(1.15);
        }
        .le-avatar-edit-btn:active,
        .le-avatar-edit-remove:active {
          transform: scale(0.95);
        }
        .le-avatar-edit-btn {
          right: -6px;
          bottom: -6px;
        }
        .le-avatar-edit-remove {
          right: -6px;
          top: -6px;
          background: #ef4444;
          width: 28px;
          height: 28px;
          font-size: 14px;
        }
        .le-avatar-edit-err {
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-top: 8px;
          background: #fef2f2;
          color: #991b1b;
          border: 1px solid #fecaca;
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 12px;
          line-height: 1.4;
          white-space: normal;
          width: 240px;
          pointer-events: auto;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
          z-index: 10;
        }
      `}</style>
    </div>
  );
}

// Resize an image File to a max dimension + JPEG-encode at the
// chosen quality. Returns a `data:image/jpeg;base64,…` URL.
async function resizeAsDataUrl(
  file: File,
  maxDim: number,
  quality: number,
): Promise<string> {
  const bitmap =
    "createImageBitmap" in window
      ? await createImageBitmap(file)
      : await loadAsImage(file);
  const w = (bitmap as { width: number }).width;
  const h = (bitmap as { height: number }).height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const targetW = Math.round(w * scale);
  const targetH = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, targetW, targetH);
  return canvas.toDataURL("image/jpeg", quality);
}

function loadAsImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image decode failed"));
    };
    img.src = url;
  });
}

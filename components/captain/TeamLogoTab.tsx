"use client";

// Team Logo tab — lets a captain upload/replace their OWN team's logo,
// no admin or developer needed. The image is resized to a 512×512 PNG in
// the browser (so no server-side image library is required) and POSTed to
// /api/captain-team-logo, which stores it and points the team's logo_url at
// the serving route. The captain can only ever change their own team's logo
// (the server derives the team from their claim — see the route).

import { useRef, useState } from "react";
import { useUser } from "@/lib/auth-client";

interface Props {
  leagueId: string;
  teamId: string;
  team: { name?: string; logo_url?: string | null };
}

const TILE = 512;

// Draw the chosen file onto a 512×512 canvas: fill the square with the
// image's own corner color, then center the whole image (contain) so
// nothing is cropped. Returns the base64 PNG payload (no data: prefix).
function toSquarePngBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = TILE;
        canvas.height = TILE;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not supported");

        // Sample the top-left pixel for the background fill.
        const probe = document.createElement("canvas");
        probe.width = img.naturalWidth;
        probe.height = img.naturalHeight;
        const pctx = probe.getContext("2d");
        let fill = "#0f1620";
        if (pctx) {
          pctx.drawImage(img, 0, 0);
          const [r, g, b] = pctx.getImageData(0, 0, 1, 1).data;
          fill = `rgb(${r},${g},${b})`;
        }
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, TILE, TILE);

        // Contain the image, centered.
        const scale = Math.min(
          TILE / img.naturalWidth,
          TILE / img.naturalHeight,
        );
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        ctx.drawImage(img, (TILE - w) / 2, (TILE - h) / 2, w, h);

        const dataUrl = canvas.toDataURL("image/png");
        const comma = dataUrl.indexOf(",");
        resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
      } catch (e) {
        reject(e as Error);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image file."));
    };
    img.src = objectUrl;
  });
}

export function TeamLogoTab({ leagueId, teamId, team }: Props) {
  const user = useUser();
  const inputRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(team.logo_url ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setError(null);
    setDone(false);

    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file (PNG or JPG).");
      return;
    }
    if (!user) {
      setError("You're signed out — reload the page and sign in again.");
      return;
    }

    setBusy(true);
    try {
      const pngBase64 = await toSquarePngBase64(file);
      const idToken = await user.getIdToken();
      const res = await fetch("/api/captain-team-logo", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, teamId, pngBase64 }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        logoUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.logoUrl) {
        throw new Error(data.error || "Upload failed. Please try again.");
      }
      setLogoUrl(data.logoUrl);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cap-tab">
      <div className="cap-section-head">
        <h2 className="cap-section-title">Team Logo</h2>
        <p className="cap-section-sub">
          Upload your team&apos;s logo. It appears across the site — standings,
          schedule, scores, and your team page. A square image works best;
          we&apos;ll size it automatically.
        </p>
      </div>

      <div className="tlogo-wrap">
        <div className="tlogo-preview" aria-live="polite">
          {logoUrl ? (
            // Plain img (not next/image) — the src is a dynamic API URL and
            // this is a small in-portal preview.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={`${team.name ?? "Team"} logo`} width={160} height={160} />
          ) : (
            <div className="tlogo-empty">No logo yet</div>
          )}
        </div>

        <div className="tlogo-actions">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onPick}
            style={{ display: "none" }}
          />
          <button
            type="button"
            className="tlogo-btn"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
          </button>
          {done && <span className="tlogo-ok">✓ Saved</span>}
          {error && <span className="tlogo-err">{error}</span>}
          <p className="tlogo-note">
            PNG or JPG. It may take a minute to update everywhere after saving.
          </p>
        </div>
      </div>

      <style>{`
        .tlogo-wrap { display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start; padding: 4px 2px; }
        .tlogo-preview { width: 160px; height: 160px; border-radius: 14px; overflow: hidden;
          background: rgba(127,127,127,.08); border: 1px solid rgba(127,127,127,.2);
          display: flex; align-items: center; justify-content: center; flex: none; }
        .tlogo-preview img { width: 100%; height: 100%; object-fit: contain; }
        .tlogo-empty { font-size: 13px; color: #7a8698; }
        .tlogo-actions { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
        .tlogo-btn { font: inherit; font-weight: 600; padding: 10px 18px; border-radius: 10px;
          border: 1px solid rgba(127,127,127,.3); background: #2f62e0; color: #fff; cursor: pointer; }
        .tlogo-btn:disabled { opacity: .6; cursor: default; }
        .tlogo-ok { color: #248a5a; font-weight: 600; font-size: 14px; }
        .tlogo-err { color: #d1263a; font-size: 14px; max-width: 34ch; }
        .tlogo-note { font-size: 12px; color: #7a8698; margin: 2px 0 0; }
      `}</style>
    </div>
  );
}

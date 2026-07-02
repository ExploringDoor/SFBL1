"use client";

// Team Logo tab — a captain uploads/replaces their team's logo from the coach
// portal. The picked image is resized client-side to a small PNG data URL and
// saved to the team doc's logo_url via /api/captain-team-logo. It then shows
// everywhere the team appears (team page, standings, score cards).

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useUser } from "@/lib/auth-client";

// Client-side resize → PNG data URL (max `max`px on the long edge).
function resizeToDataUrl(file: File, max: number): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve("");
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => resolve("");
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(String(reader.result));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function TeamLogoTab({
  leagueId,
  teamId,
}: {
  leagueId: string;
  teamId: string;
}) {
  const user = useUser();
  const [current, setCurrent] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null); // newly picked, unsaved
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(getDb(), `leagues/${leagueId}/teams/${teamId}`));
        setCurrent((snap.data()?.logo_url as string | undefined) ?? null);
      } catch {
        /* leave null */
      } finally {
        setLoading(false);
      }
    })();
  }, [leagueId, teamId]);

  const shown = pending ?? current;

  async function post(payload: Record<string, unknown>) {
    if (!user) {
      setError("Please sign in again.");
      return false;
    }
    const idToken = await user.getIdToken();
    const res = await fetch("/api/captain-team-logo", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ leagueId, ...payload }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      setError(data.error ?? `HTTP ${res.status}`);
      return false;
    }
    return true;
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setSaved(false);
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await resizeToDataUrl(file, 320);
    if (!url) {
      setError("Couldn't read that image — try a PNG or JPG.");
      return;
    }
    setPending(url);
  }

  async function save() {
    if (!pending) return;
    setSaving(true);
    setError(null);
    if (await post({ logo: pending })) {
      setCurrent(pending);
      setPending(null);
      setSaved(true);
    }
    setSaving(false);
  }

  async function remove() {
    setSaving(true);
    setError(null);
    if (await post({ clear: true })) {
      setCurrent(null);
      setPending(null);
      setSaved(true);
    }
    setSaving(false);
  }

  return (
    <div>
      <div className="cap-section-head">
        <div className="cap-section-title">Team Logo</div>
        <div className="cap-section-sub">
          Upload your team&rsquo;s logo (PNG or JPG). It appears on your team
          page, the standings, and score cards. A transparent PNG looks best.
        </div>
      </div>

      {error && <div className="cap-error-banner">{error}</div>}
      {saved && (
        <div
          style={{
            background: "rgba(22,163,74,0.1)",
            color: "#15803d",
            border: "1px solid rgba(22,163,74,0.3)",
            borderRadius: 8,
            padding: "8px 12px",
            marginBottom: 14,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          ✓ Saved — your logo is live on the site.
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            padding: 8,
            color: "var(--muted)",
            fontSize: 12,
            textAlign: "center",
          }}
        >
          {loading ? (
            "…"
          ) : shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shown}
              alt="Team logo"
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            />
          ) : (
            "No logo yet"
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onPick} />
          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={save}
              disabled={!pending || saving}
              style={{
                border: "none",
                borderRadius: 8,
                padding: "9px 18px",
                background: "var(--brand-primary)",
                color: "#fff",
                fontWeight: 800,
                fontSize: 14,
                cursor: !pending || saving ? "default" : "pointer",
                opacity: !pending || saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving…" : pending ? "Save logo" : "Save"}
            </button>
            {current && (
              <button
                type="button"
                className="cap-btn-danger"
                onClick={remove}
                disabled={saving}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

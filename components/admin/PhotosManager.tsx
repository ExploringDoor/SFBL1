"use client";

// Admin photos panel.
//
// Upload photos from phone or computer, add captions, optionally
// set when the photo was taken. Photos appear at /photos in
// reverse chronological order. Hidden photos stay in the gallery
// but don't show up publicly.

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs, query } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface Photo {
  id: string;
  image_data_url: string;
  caption: string;
  taken_at: string | null;
  uploaded_at: string;
  hidden: boolean;
}

interface Props {
  leagueId: string;
  user: User;
}

export function PhotosManager({ leagueId, user }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Upload form state
  const [pickedDataUrl, setPickedDataUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [takenAt, setTakenAt] = useState("");

  async function load() {
    setLoading(true);
    try {
      const db = getDb();
      const snap = await getDocs(
        query(collection(db, `leagues/${leagueId}/photos`)),
      );
      setPhotos(
        snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              image_data_url: String(data.image_data_url ?? ""),
              caption: String(data.caption ?? ""),
              taken_at:
                typeof data.taken_at === "string" ? data.taken_at : null,
              uploaded_at: String(data.uploaded_at ?? ""),
              hidden: data.hidden === true,
            };
          })
          .sort((a, b) => {
            const at = a.taken_at || a.uploaded_at;
            const bt = b.taken_at || b.uploaded_at;
            return at < bt ? 1 : at > bt ? -1 : 0;
          }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  function handleFile(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Pick an image file (PNG / JPG / GIF / HEIC).");
      return;
    }
    if (file.size > 1_500_000) {
      setError(
        `Photo is ${(file.size / 1024 / 1024).toFixed(1)} MB — keep originals under 1.5 MB. ` +
          `iPhone owners: Settings → Camera → Formats → "Most Compatible" shrinks new photos.`,
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPickedDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  async function call(body: Record<string, unknown>): Promise<boolean> {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-photo", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, ...body }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return false;
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (!pickedDataUrl) return;
    const ok = await call({
      action: "upload",
      imageDataUrl: pickedDataUrl,
      caption: caption.trim(),
      taken_at: takenAt || null,
    });
    if (ok) {
      setSuccess("Photo uploaded.");
      setPickedDataUrl(null);
      setCaption("");
      setTakenAt("");
      await load();
    }
  }

  async function deletePhoto(p: Photo) {
    if (
      !window.confirm(
        `Delete this photo? "${p.caption || "(no caption)"}". This is permanent.`,
      )
    )
      return;
    const ok = await call({ action: "delete", photoId: p.id });
    if (ok) {
      setSuccess("Photo deleted.");
      await load();
    }
  }

  async function toggleHide(p: Photo) {
    const ok = await call({
      action: "update",
      photoId: p.id,
      hidden: !p.hidden,
    });
    if (ok) {
      setSuccess(p.hidden ? "Photo unhidden." : "Photo hidden.");
      await load();
    }
  }

  async function editCaption(p: Photo) {
    const newCaption = window.prompt("Caption (leave blank to clear):", p.caption);
    if (newCaption === null) return; // cancel
    const ok = await call({
      action: "update",
      photoId: p.id,
      caption: newCaption,
    });
    if (ok) {
      setSuccess("Caption updated.");
      await load();
    }
  }

  return (
    <section className="space-y-4 rounded-md border border-slate-200 bg-white p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <p className="text-lg font-bold text-slate-900">Photos</p>
          <p className="text-sm text-slate-600 mt-1">
            Photos appear publicly at <code>/photos</code> in newest-first
            order. Add captions and dates so fans know what they're looking
            at.
          </p>
        </div>
        <a
          href="/photos"
          target="_blank"
          rel="noopener"
          className="text-xs text-slate-500 underline hover:text-slate-900"
        >
          View public page →
        </a>
      </div>

      {/* Upload card */}
      <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
        <p className="text-sm font-bold text-slate-900">📸 Add a photo</p>
        <div className="flex items-start gap-3">
          {pickedDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pickedDataUrl}
              alt="Preview"
              className="h-24 w-32 rounded border border-slate-200 object-cover"
            />
          ) : (
            <label className="flex h-24 w-32 cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed border-emerald-300 bg-white hover:bg-emerald-100 text-xs text-emerald-700 font-semibold">
              <span className="text-2xl">+</span>
              <span>Choose photo</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.currentTarget.value = "";
                }}
                disabled={busy}
              />
            </label>
          )}
          <div className="flex-1 space-y-2">
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Caption (e.g. 'Margate Marlins celebrate spring 2023 championship')"
              maxLength={200}
              disabled={busy}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-700 font-semibold flex items-center gap-2">
                Date taken (optional)
                <input
                  type="date"
                  value={takenAt}
                  onChange={(e) => setTakenAt(e.target.value)}
                  disabled={busy}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
              </label>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={upload}
            disabled={busy || !pickedDataUrl}
            className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Upload photo"}
          </button>
          {pickedDataUrl && (
            <button
              type="button"
              onClick={() => {
                setPickedDataUrl(null);
                setCaption("");
                setTakenAt("");
              }}
              disabled={busy}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-700 rounded bg-red-50 px-2 py-1 border border-red-200">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-emerald-700 rounded bg-emerald-50 px-2 py-1 border border-emerald-200">
          {success}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading photos…</p>
      ) : photos.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          No photos yet. Upload your first above.
        </p>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((p) => (
            <div
              key={p.id}
              className={
                "relative rounded-md border border-slate-200 overflow-hidden " +
                (p.hidden ? "opacity-60" : "")
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.image_data_url}
                alt={p.caption || "League photo"}
                className="w-full h-32 object-cover bg-slate-100"
              />
              {p.hidden && (
                <span className="absolute top-1 left-1 rounded bg-slate-900/80 text-white text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5">
                  Hidden
                </span>
              )}
              <div className="p-2 text-xs">
                <div className="text-slate-700 line-clamp-2 min-h-[2rem]">
                  {p.caption || (
                    <span className="italic text-slate-400">No caption</span>
                  )}
                </div>
                {p.taken_at && (
                  <div className="text-slate-500 text-[10px] mt-1">
                    {new Date(p.taken_at).toLocaleDateString()}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => editCaption(p)}
                    disabled={busy}
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleHide(p)}
                    disabled={busy}
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {p.hidden ? "Unhide" : "Hide"}
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePhoto(p)}
                    disabled={busy}
                    className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

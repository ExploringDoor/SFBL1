"use client";

// Tournament logos, editable by the office.
//
// Built on 2026-08-19 because Adam needed Mike to change these himself. The
// tournament slate is a checked-in JSON file, so until now every logo, and
// there were four in one evening, went through Adam.
//
// SCOPE IS DELIBERATELY LOGOS ONLY. Dates, prices and names stay in the file.
// That removes the request that actually recurs without building a whole
// tournament CMS, and the events are the part that changes once a season.
//
// The picked file is resized to 500px and encoded JPEG in the browser before
// it is sent, which is what keeps it inside a Firestore document. The same
// trick as team logos: no Storage bucket to provision and nowhere else for an
// image to go missing.
//
// Nothing is destructive. An upload OVERRIDES the checked-in art; "Use
// original" deletes the override and the committed file comes back. Mike can
// try something at 11pm and undo it.

import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import islandData from "@/app/tournaments/island-fall-2026.json";
import { tournamentSlug } from "@/lib/tournament-slug";

interface SlateEvent {
  name: string;
  start: string;
  logo?: string;
}

interface Props {
  leagueId: string;
  user: User;
}

// JPEG, not PNG. These are photographic tee designs on solid backgrounds, so
// JPEG at 500px lands near 60-90KB where PNG is 300-400KB. Firestore caps a
// document at 1MB and the data URL adds a third on top in base64, so the
// format choice is what makes this fit at all.
function resizeToDataUrl(file: File, max = 500): Promise<string> {
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
        if (!ctx) return resolve("");
        // White underneath, because a transparent PNG flattened onto JPEG's
        // default black turns a dark logo into a black square.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function TournamentLogosManager({ leagueId, user }: Props) {
  const events = ((islandData as { events: SlateEvent[] }).events ?? [])
    .slice()
    .sort((a, b) => a.start.localeCompare(b.start));

  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  // Read the current overrides straight from the API the public pages use, so
  // this panel shows exactly what the site shows.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/admin-tournament-logos?leagueId=${encodeURIComponent(leagueId)}`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        if (!res.ok) return;
        const j = (await res.json()) as { logos?: Record<string, string> };
        if (!cancelled) setOverrides(j.logos ?? {});
      } catch {
        /* panel still works; it just shows the committed art */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, user]);

  async function send(slug: string, name: string, body: Record<string, unknown>) {
    setBusy(slug);
    setErr(null);
    setMsg(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin-tournament-logo", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ leagueId, slug, name, ...body }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErr(j.error ?? `Something went wrong (${res.status})`);
        return false;
      }
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function onPick(ev: SlateEvent, file: File) {
    const slug = tournamentSlug(ev.name);
    if (!file.type.startsWith("image/")) {
      setErr("That file is not an image.");
      return;
    }
    const dataUrl = await resizeToDataUrl(file);
    if (!dataUrl) {
      setErr("Could not read that image. Try a JPG or PNG.");
      return;
    }
    if (await send(slug, ev.name, { logo: dataUrl })) {
      setOverrides((o) => ({ ...o, [slug]: dataUrl }));
      setMsg(`${ev.name} updated. It is live on the site now.`);
    }
  }

  async function onReset(ev: SlateEvent) {
    const slug = tournamentSlug(ev.name);
    if (await send(slug, ev.name, { clear: true })) {
      setOverrides((o) => {
        const next = { ...o };
        delete next[slug];
        return next;
      });
      setMsg(`${ev.name} is back to the original logo.`);
    }
  }

  return (
    <section className="le-tlogos">
      <h2 className="le-tlogos-h2">Tournament logos</h2>
      <p className="le-tlogos-intro">
        Upload a new logo for any tournament. It goes live straight away, on
        the tournaments page and on the home page. Any size or format is fine,
        it gets resized automatically. &ldquo;Use original&rdquo; puts the
        built-in artwork back.
      </p>

      {err && <p className="le-tlogos-err">{err}</p>}
      {msg && <p className="le-tlogos-ok">{msg}</p>}

      <ul className="le-tlogos-list">
        {events.map((ev) => {
          const slug = tournamentSlug(ev.name);
          const current = overrides[slug] || ev.logo || null;
          const isOverride = Boolean(overrides[slug]);
          return (
            <li key={slug} className="le-tlogos-row">
              <span className="le-tlogos-thumb">
                {current ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={current} alt="" />
                ) : (
                  <span className="le-tlogos-none">No logo</span>
                )}
              </span>

              <span className="le-tlogos-name">
                {ev.name}
                {isOverride && (
                  <span className="le-tlogos-badge">Custom</span>
                )}
              </span>

              <span className="le-tlogos-actions">
                <input
                  ref={(el) => {
                    inputs.current[slug] = el;
                  }}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    // Cleared so picking the SAME file twice still fires a
                    // change event, which is how a retry after an error works.
                    e.target.value = "";
                    if (f) void onPick(ev, f);
                  }}
                />
                <button
                  type="button"
                  className="le-tlogos-btn"
                  disabled={busy === slug}
                  onClick={() => inputs.current[slug]?.click()}
                >
                  {busy === slug ? "Uploading…" : "Upload new"}
                </button>
                {isOverride && (
                  <button
                    type="button"
                    className="le-tlogos-btn le-tlogos-btn-quiet"
                    disabled={busy === slug}
                    onClick={() => void onReset(ev)}
                  >
                    Use original
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

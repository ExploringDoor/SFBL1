"use client";

// Admin Branding form — lets the commissioner update league name,
// abbrev, brand colors, and logo URL from the UI instead of having
// to edit Firestore by hand or run the provisioning script again.
//
// Curated by design (per the "don't build a WYSIWYG" memo): three
// hex color pickers, a logo URL field, name + abbrev. No fonts (the
// platform's Barlow / Inter / Oswald stack is locked). No layout
// options. No custom CSS. If a tenant wants more, that's a paid
// custom job.
//
// Logo upload: today this field is just a URL. Once Firebase Storage
// + media library lands (v1 work after first 1-2 tenants), the
// commissioner picks from their uploaded assets. For SFBL launch
// they paste a /logos/sfbl/sfbl-logo.png path or a Firebase Storage
// URL.
//
// Live preview shows the colors as swatches. Theme variables on the
// page itself update on next reload — this UI doesn't try to live-
// rebroadcast the page (would require client-side context wiring
// for ~zero benefit on a page admins visit infrequently).

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface BrandingState {
  name: string;
  abbrev: string;
  primary: string;
  accent: string;
  secondary: string;
  logo_url: string;
}

interface Props {
  leagueId: string;
  user: User;
}

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const DEFAULT: BrandingState = {
  name: "",
  abbrev: "",
  primary: "#002d72",
  accent: "#f5c842",
  secondary: "",
  logo_url: "",
};

export function BrandingSection({ leagueId, user }: Props) {
  const [state, setState] = useState<BrandingState>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(
    null,
  );

  // Load current branding from /leagues/{id}.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = getDb();
        const snap = await getDoc(doc(db, `leagues/${leagueId}`));
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data() as Record<string, unknown>;
          const theme =
            (data.theme as Record<string, string> | undefined) ?? {};
          setState({
            name: String(data.name ?? ""),
            abbrev: String(data.abbrev ?? ""),
            primary: String(theme.primary ?? DEFAULT.primary),
            accent: String(theme.accent ?? DEFAULT.accent),
            secondary: String(theme.secondary ?? ""),
            logo_url: String(theme.logo_url ?? ""),
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

  async function save() {
    setSaving(true);
    setResult(null);
    // Client-side validation — server reverifies but we want to fail
    // fast on the obvious cases.
    for (const c of [state.primary, state.accent, state.secondary] as const) {
      if (c && !HEX_RE.test(c)) {
        setResult({
          ok: false,
          msg: `"${c}" isn't a hex color. Use #RRGGBB form.`,
        });
        setSaving(false);
        return;
      }
    }
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-branding", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          name: state.name,
          abbrev: state.abbrev,
          theme: {
            primary: state.primary,
            accent: state.accent,
            ...(state.secondary ? { secondary: state.secondary } : {}),
            logo_url: state.logo_url,
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        updated?: string[];
      };
      if (!res.ok) {
        setResult({ ok: false, msg: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setResult({
        ok: true,
        msg: `Saved. Reload the public site to see changes (${
          data.updated?.length ?? 0
        } field${data.updated?.length === 1 ? "" : "s"} updated).`,
      });
    } catch (e) {
      setResult({
        ok: false,
        msg: e instanceof Error ? e.message : "Save failed",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <p className="font-semibold text-slate-900">Branding</p>
        <p className="text-sm text-slate-500 mt-2">Loading…</p>
      </section>
    );
  }

  return (
    <section className="space-y-5 rounded-md border border-slate-200 bg-white p-5">
      <div>
        <p className="text-lg font-bold text-slate-900">Branding</p>
        <p className="text-sm text-slate-600 mt-1">
          Set your league's name, colors, and logo. Reload the public site
          after saving to see your changes.
        </p>
      </div>

      {/* ── Live preview ─── shows what colors look like together. */}
      <div className="rounded-md border border-slate-200 overflow-hidden">
        <div
          className="px-4 py-6 flex items-center gap-3"
          style={{ background: state.primary, color: "#fff" }}
        >
          {state.logo_url && (
            <img
              src={state.logo_url}
              alt=""
              className="h-10 w-10 rounded bg-white/10 object-contain p-1"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          <div className="flex-1">
            <div className="font-bold tracking-wide uppercase">
              {state.name || "Your league name"}
            </div>
            <div className="text-xs opacity-80">{state.abbrev || "ABC"}</div>
          </div>
          <button
            type="button"
            disabled
            className="rounded-md px-3 py-1.5 text-xs font-bold uppercase"
            style={{ background: state.accent, color: "#000" }}
          >
            Sign up
          </button>
        </div>
        <div className="bg-white px-4 py-2 text-xs text-slate-500 border-t border-slate-200">
          ↑ Preview of your homepage banner
        </div>
      </div>

      {/* ── Basics ─── name + short name */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="block text-sm font-semibold text-slate-800 mb-1.5">
            League name
          </span>
          <input
            type="text"
            value={state.name}
            onChange={(e) => setState({ ...state, name: e.target.value })}
            disabled={saving}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="South Florida Baseball League"
            maxLength={100}
          />
        </label>
        <label className="block">
          <span className="block text-sm font-semibold text-slate-800 mb-1.5">
            Short name
          </span>
          <input
            type="text"
            value={state.abbrev}
            onChange={(e) =>
              setState({ ...state, abbrev: e.target.value.toUpperCase() })
            }
            disabled={saving}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="SFBL"
            maxLength={12}
          />
          <span className="block text-xs text-slate-500 mt-1">
            Shown in tight spaces like the score ticker.
          </span>
        </label>
      </div>

      {/* ── Colors ─── friendly labels, big swatches, no hex codes
          unless you click "Show codes". */}
      <div>
        <span className="block text-sm font-semibold text-slate-800 mb-2">
          Colors
        </span>
        <div className="grid gap-3 sm:grid-cols-2">
          <FriendlyColor
            label="Main color"
            sublabel="Headers, banners, navigation"
            value={state.primary}
            onChange={(v) => setState({ ...state, primary: v })}
            disabled={saving}
          />
          <FriendlyColor
            label="Highlight color"
            sublabel="Buttons, badges, links"
            value={state.accent}
            onChange={(v) => setState({ ...state, accent: v })}
            disabled={saving}
          />
        </div>
      </div>

      {/* ── Logo ─── upload a file directly. We base64-encode the
          image and store it as a data URL on the league config; the
          1MB Firestore doc cap is generous for league logos
          (target ~50KB). When Firebase Storage lands we'll switch
          to upload-to-bucket and keep a URL pointer. */}
      <div>
        <span className="block text-sm font-semibold text-slate-800 mb-1.5">
          Logo
        </span>
        <div className="flex items-center gap-3">
          {state.logo_url ? (
            <img
              src={state.logo_url}
              alt="Current logo"
              className="h-16 w-16 rounded border border-slate-200 object-contain bg-slate-50 flex-shrink-0"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="h-16 w-16 rounded border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center text-xs text-slate-400 flex-shrink-0">
              No logo
            </div>
          )}
          <div className="flex-1">
            <label className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white cursor-pointer hover:brightness-110">
              📁 Choose file…
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 800_000) {
                    setResult({
                      ok: false,
                      msg: `Image is ${(f.size / 1024 / 1024).toFixed(1)} MB — keep it under 800 KB so the league config stays comfortably under Firestore's 1 MB doc limit.`,
                    });
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result === "string") {
                      setState({ ...state, logo_url: reader.result });
                      setResult(null);
                    }
                  };
                  reader.readAsDataURL(f);
                }}
                disabled={saving}
                className="hidden"
              />
            </label>
            {state.logo_url && (
              <button
                type="button"
                onClick={() => setState({ ...state, logo_url: "" })}
                disabled={saving}
                className="ml-2 text-xs text-slate-500 underline hover:text-slate-900"
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <span className="block text-xs text-slate-500 mt-2">
          PNG / JPG / SVG / WebP, square 512×512 works best, under 800 KB.
          The logo appears on the homepage banner, push notifications,
          and PWA install icon.
        </span>
      </div>

      {/* ── Advanced ─── secondary color + raw hex codes for power users. */}
      <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <summary className="text-sm font-semibold text-slate-700 cursor-pointer">
          Advanced
        </summary>
        <div className="mt-3 space-y-3">
          <FriendlyColor
            label="Secondary color (optional)"
            sublabel="Subtle accents — leave blank if not needed"
            value={state.secondary}
            onChange={(v) => setState({ ...state, secondary: v })}
            disabled={saving}
            allowEmpty
          />
          <div className="text-xs text-slate-600">
            Hex codes for designers:
            <span className="ml-2 font-mono">
              main {state.primary || "—"}, highlight {state.accent || "—"}
              {state.secondary ? `, secondary ${state.secondary}` : ""}
            </span>
          </div>
        </div>
      </details>

      <div className="flex items-center justify-end pt-2 border-t border-slate-100">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save branding"}
        </button>
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

function FriendlyColor({
  label,
  sublabel,
  value,
  onChange,
  disabled,
  allowEmpty,
}: {
  label: string;
  sublabel: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  allowEmpty?: boolean;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-3">
        {/* Big visible color swatch — primary affordance is the
            color picker, not a hex string the commissioner shouldn't
            need to know exists. */}
        <input
          type="color"
          value={value || "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-12 w-12 rounded-md border border-slate-300 p-0.5 cursor-pointer disabled:opacity-50"
          aria-label={`${label} color picker`}
        />
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-800">{label}</div>
          <div className="text-xs text-slate-500">{sublabel}</div>
          {allowEmpty && value && (
            <button
              type="button"
              onClick={() => onChange("")}
              className="mt-1 text-xs text-slate-500 underline hover:text-slate-900"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


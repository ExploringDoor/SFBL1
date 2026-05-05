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
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div>
        <p className="font-semibold text-slate-900">Branding</p>
        <p className="text-xs text-slate-600 mt-1 leading-relaxed">
          League name, abbreviation, theme colors, and logo. Reload the
          public site after saving — these power the homepage banner,
          captain portal hero, push notification icon, and PWA install
          appearance.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
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
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Abbrev (3-letter, used in tickers)
          </span>
          <input
            type="text"
            value={state.abbrev}
            onChange={(e) =>
              setState({ ...state, abbrev: e.target.value.toUpperCase() })
            }
            disabled={saving}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
            placeholder="SFBL"
            maxLength={12}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <ColorField
          label="Primary"
          help="Headers, hero, primary buttons"
          value={state.primary}
          onChange={(v) => setState({ ...state, primary: v })}
          disabled={saving}
        />
        <ColorField
          label="Accent"
          help="CTAs, highlights, badges"
          value={state.accent}
          onChange={(v) => setState({ ...state, accent: v })}
          disabled={saving}
        />
        <ColorField
          label="Secondary (optional)"
          help="Subtle accents (clear to skip)"
          value={state.secondary}
          onChange={(v) => setState({ ...state, secondary: v })}
          disabled={saving}
          allowEmpty
        />
      </div>

      <label className="block">
        <span className="block text-xs font-semibold text-slate-700 mb-1">
          Logo URL
        </span>
        <input
          type="text"
          value={state.logo_url}
          onChange={(e) => setState({ ...state, logo_url: e.target.value })}
          disabled={saving}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
          placeholder="/logos/sfbl/sfbl-logo.png"
        />
        <span className="block text-xs text-slate-500 mt-1">
          Path under /public (e.g. <code>/logos/sfbl/sfbl-logo.png</code>) or
          a full https URL. PWA install icon and apple-touch-icon use
          this — ideally a 512×512 PNG with the logo on a brand-color
          background.
        </span>
      </label>

      <div className="flex items-center justify-between">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save branding"}
        </button>
        {state.logo_url && (
          <img
            src={state.logo_url}
            alt="Logo preview"
            className="h-12 w-12 rounded border border-slate-200 object-contain bg-slate-50"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
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

function ColorField({
  label,
  help,
  value,
  onChange,
  disabled,
  allowEmpty,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  allowEmpty?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-700 mb-1">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-9 w-12 rounded border border-slate-300 p-0.5 disabled:opacity-50 cursor-pointer"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={allowEmpty ? "(leave blank to skip)" : "#000000"}
          className="flex-1 rounded-md border border-slate-300 px-2 py-2 text-sm font-mono"
        />
      </div>
      <span className="block text-xs text-slate-500 mt-1">{help}</span>
    </label>
  );
}

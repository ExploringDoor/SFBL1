"use client";

// Admin "Manage Fields" — add / edit / remove the league's fields
// (Adam, 2026-06: self-serve so Nelson can add new locations himself).
//
// Fields live in /leagues/{id}/site_config/fields as
//   { data: [{ name, address, mapsUrl?, appleMapsUrl? }] }
// Admins can write site_config directly (firestore.rules), so no API
// route is needed — same pattern as the Field Usage rates editor.
//
// name + address is all that's required: the public /fields page and
// the schedule field dropdown both read from here, and /fields
// synthesizes Google + Apple Maps links from the address automatically.

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface Props {
  leagueId: string;
  user: User;
}

interface FieldEntry {
  name: string;
  address: string;
  mapsUrl?: string;
  appleMapsUrl?: string;
}

export function FieldsManager({ leagueId }: Props) {
  const [fields, setFields] = useState<FieldEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const db = getDb();
        const snap = await getDoc(
          doc(db, `leagues/${leagueId}/site_config/fields`),
        );
        const arr = snap.exists() ? snap.data()?.data : null;
        const list: FieldEntry[] = Array.isArray(arr)
          ? arr
              .map((f): FieldEntry =>
                typeof f === "string"
                  ? { name: f, address: "" }
                  : {
                      name: String(f?.name ?? ""),
                      address: String(f?.address ?? ""),
                      mapsUrl:
                        typeof f?.mapsUrl === "string" ? f.mapsUrl : undefined,
                      appleMapsUrl:
                        typeof f?.appleMapsUrl === "string"
                          ? f.appleMapsUrl
                          : undefined,
                    },
              )
              .filter((f) => f.name || f.address)
          : [];
        list.sort((a, b) => a.name.localeCompare(b.name));
        if (alive) setFields(list);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [leagueId]);

  function edit(i: number, key: "name" | "address", val: string) {
    setFields((cur) => cur.map((f, idx) => (idx === i ? { ...f, [key]: val } : f)));
    setSaved(false);
  }
  function addRow() {
    setFields((cur) => [...cur, { name: "", address: "" }]);
    setSaved(false);
  }
  function removeRow(i: number) {
    setFields((cur) => cur.filter((_, idx) => idx !== i));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const clean = fields
        .map((f) => {
          const entry: FieldEntry = {
            name: f.name.trim(),
            address: f.address.trim(),
          };
          // Preserve any explicit map links already on the record.
          if (f.mapsUrl) entry.mapsUrl = f.mapsUrl;
          if (f.appleMapsUrl) entry.appleMapsUrl = f.appleMapsUrl;
          return entry;
        })
        .filter((f) => f.name);
      const db = getDb();
      await setDoc(
        doc(db, `leagues/${leagueId}/site_config/fields`),
        { data: clean },
        { merge: true },
      );
      clean.sort((a, b) => a.name.localeCompare(b.name));
      setFields(clean);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-900">Manage Fields</h2>
        <p className="text-sm text-slate-600">
          Add, edit, or remove the league&rsquo;s fields. Each one appears in
          the schedule&rsquo;s field dropdown and on the public{" "}
          <strong>Fields</strong> page — with Google &amp; Apple Maps
          directions generated automatically from the address.
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading fields…</p>
      ) : (
        <>
          <div className="space-y-2">
            {fields.length === 0 && (
              <p className="text-sm italic text-slate-500">
                No fields yet. Add one below.
              </p>
            )}
            {fields.map((f, i) => (
              <div
                key={i}
                className="flex flex-wrap items-start gap-2 rounded-md border border-slate-200 bg-white p-2 sm:flex-nowrap"
              >
                <input
                  type="text"
                  value={f.name}
                  onChange={(e) => edit(i, "name", e.target.value)}
                  placeholder="Field name (e.g. Flamingo Park)"
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm sm:w-56"
                />
                <input
                  type="text"
                  value={f.address}
                  onChange={(e) => edit(i, "address", e.target.value)}
                  placeholder="Full address (street, city, state ZIP)"
                  className="w-full flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-500 hover:bg-red-50 hover:text-red-700"
                  aria-label={`Remove ${f.name || "field"}`}
                  title="Remove field"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={addRow}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              + Add field
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-brand-primary px-4 py-1.5 text-sm font-semibold text-on-primary hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save fields"}
            </button>
            {saved && (
              <span className="text-sm font-semibold text-emerald-700">
                ✓ Saved
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Tip: a complete address (street, city, state, ZIP) makes the map
            directions accurate. Empty rows are skipped on save.
          </p>
        </>
      )}
    </div>
  );
}

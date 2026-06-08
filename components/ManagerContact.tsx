"use client";

// Shared "manager / captain contact on file" card — view + edit.
// Reads/writes the team's PRIVATE contact subdoc
// (leagues/{id}/teams/{teamId}/_private/contact = { managers:
// [{name, email}] }). That path is admin-OR-captain-of-team
// read/write per firestore.rules, so both the admin Teams tab and a
// logged-in captain can use this directly via the client SDK — no
// API needed. Emails are PII and never live on the public team doc,
// which is why this uses the private subdoc.
//
// Used by:
//   - components/admin/TeamsManager (admin: every team)
//   - app/captain (a captain: their own team — can fix their email)

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface Mgr {
  name: string;
  email: string;
}

export function ManagerContact({
  leagueId,
  teamId,
  title = "Manager / captain contact",
}: {
  leagueId: string;
  teamId: string;
  title?: string;
}) {
  const [mgrs, setMgrs] = useState<Mgr[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Mgr[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    try {
      const snap = await getDoc(
        doc(getDb(), `leagues/${leagueId}/teams/${teamId}/_private/contact`),
      );
      const data = snap.exists() ? snap.data() : null;
      const arr = Array.isArray(data?.managers)
        ? (data!.managers as unknown[]).map((m) => {
            const o = (m ?? {}) as Record<string, unknown>;
            return { name: String(o.name ?? ""), email: String(o.email ?? "") };
          })
        : [];
      setMgrs(arr);
    } catch {
      setMgrs([]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, teamId]);

  function startEdit() {
    setDraft(mgrs && mgrs.length ? mgrs.map((m) => ({ ...m })) : [{ name: "", email: "" }]);
    setMsg(null);
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const managers = draft
        .map((m) => ({
          name: m.name.trim(),
          email: m.email.trim().toLowerCase(),
        }))
        .filter((m) => m.name || m.email);
      await setDoc(
        doc(getDb(), `leagues/${leagueId}/teams/${teamId}/_private/contact`),
        { managers, updated_at: new Date().toISOString() },
        { merge: true },
      );
      setEditing(false);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed (permission?)");
    } finally {
      setBusy(false);
    }
  }

  if (mgrs === null) return null; // still loading

  const cardStyle: React.CSSProperties = {
    border: "1px solid rgba(0,0,0,0.1)",
    borderLeft: "4px solid var(--brand-primary, #002d72)",
    borderRadius: 10,
    padding: "12px 14px",
    background: "rgba(0,0,0,0.02)",
  };
  const labelStyle: React.CSSProperties = {
    margin: "0 0 8px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--muted, #64748b)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  };
  const btn: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    border: "1px solid var(--brand-primary, #002d72)",
    color: "var(--brand-primary, #002d72)",
    background: "white",
    borderRadius: 6,
    padding: "3px 10px",
    cursor: "pointer",
  };

  if (editing) {
    return (
      <div style={cardStyle}>
        <p style={labelStyle}>{title}</p>
        {draft.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            <input
              value={m.name}
              placeholder="Name"
              onChange={(e) =>
                setDraft((d) => d.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
              }
              style={{ flex: "1 1 130px", minWidth: 0, padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 }}
            />
            <input
              type="email"
              value={m.email}
              placeholder="email@example.com"
              onChange={(e) =>
                setDraft((d) => d.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))
              }
              style={{ flex: "2 1 180px", minWidth: 0, padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 }}
            />
            <button
              type="button"
              onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
              title="Remove"
              style={{ ...btn, border: "1px solid #fca5a5", color: "#b91c1c" }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setDraft((d) => [...d, { name: "", email: "" }])}
          style={{ ...btn, marginTop: 2 }}
        >
          + Add another
        </button>
        {msg && <p style={{ color: "#b91c1c", fontSize: 12, margin: "8px 0 0" }}>{msg}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            style={{ ...btn, background: "var(--brand-primary, #002d72)", color: "white", opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(false)} disabled={busy} style={btn}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <p style={labelStyle}>
        <span>{title}</span>
        <button type="button" onClick={startEdit} style={btn}>
          Edit
        </button>
      </p>
      {mgrs.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted, #64748b)" }}>
          None on file — tap Edit to add.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {mgrs.map((m, i) => (
            <li key={i} style={{ fontSize: 14, lineHeight: 1.5, color: "var(--text-strong, #0f172a)" }}>
              <strong>{m.name || "(unnamed)"}</strong>
              {m.email ? (
                <>
                  {" — "}
                  <a href={`mailto:${m.email}`} style={{ color: "var(--brand-primary, #002d72)" }}>
                    {m.email}
                  </a>
                </>
              ) : (
                <span style={{ color: "#b45309" }}> — no email on file</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

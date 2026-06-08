"use client";

// Shared read-only "manager / captain contact on file" card. Reads
// the team's PRIVATE contact subdoc (leagues/{id}/teams/{teamId}/
// _private/contact) which holds { managers: [{name, email}] }. That
// path is admin-OR-captain-of-team readable per firestore.rules, so
// this works on both the admin Teams tab and the captain dashboard
// via the client SDK — no API needed. Emails are PII and never live
// on the public team doc, which is why this reads the subdoc.
//
// Used by:
//   - components/admin/TeamsManager (admin sees every team's captain)
//   - app/captain (a captain sees their own team's contact on file)

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(
          doc(getDb(), `leagues/${leagueId}/teams/${teamId}/_private/contact`),
        );
        if (cancelled) return;
        const data = snap.exists() ? snap.data() : null;
        const arr = Array.isArray(data?.managers)
          ? (data!.managers as unknown[]).map((m) => {
              const o = (m ?? {}) as Record<string, unknown>;
              return {
                name: String(o.name ?? ""),
                email: String(o.email ?? ""),
              };
            })
          : [];
        setMgrs(arr);
      } catch {
        if (!cancelled) setMgrs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, teamId]);

  if (mgrs === null) return null; // still loading — render nothing

  return (
    <div
      style={{
        border: "1px solid rgba(0,0,0,0.1)",
        borderLeft: "4px solid var(--brand-primary, #002d72)",
        borderRadius: 10,
        padding: "12px 14px",
        background: "rgba(0,0,0,0.02)",
      }}
    >
      <p
        style={{
          margin: "0 0 8px",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--muted, #64748b)",
        }}
      >
        {title}
      </p>
      {mgrs.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted, #64748b)" }}>
          None on file.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {mgrs.map((m, i) => (
            <li
              key={i}
              style={{
                fontSize: 14,
                lineHeight: 1.5,
                color: "var(--text-strong, #0f172a)",
              }}
            >
              <strong>{m.name || "(unnamed)"}</strong>
              {m.email ? (
                <>
                  {" — "}
                  <a
                    href={`mailto:${m.email}`}
                    style={{ color: "var(--brand-primary, #002d72)" }}
                  >
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

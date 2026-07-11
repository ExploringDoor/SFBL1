"use client";

// Admin "Send Message" — email + text blast to the league's Alerts sign-up
// list. Email via SendGrid, text via Twilio (both server-side, env-gated).
// Shows what's wired + a live recipient count, supports a test-send to
// yourself, then a send to everyone.

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

interface Props {
  leagueId: string;
  user: User | null;
}

interface Status {
  emailConfigured: boolean;
  smsConfigured: boolean;
  counts: { total: number; email: number; sms: number };
  ageGroups: string[];
}

export function BroadcastSection({ leagueId, user }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [ageGroup, setAgeGroup] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [sendSms, setSendSms] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const qs = new URLSearchParams({ leagueId });
      if (ageGroup) qs.set("ageGroup", ageGroup);
      const res = await fetch(`/api/admin-broadcast?${qs.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.ok) setStatus((await res.json()) as Status);
    } catch {
      /* ignore — the form still works, just no live count */
    }
  }, [leagueId, user, ageGroup]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function send(test: boolean) {
    if (!user) return;
    setError(null);
    setResult(null);
    if (!message.trim()) {
      setError("Write a message first.");
      return;
    }
    if (!sendEmail && !sendSms) {
      setError("Pick at least one channel (email or text).");
      return;
    }
    if (test && !testEmail.trim() && !testPhone.trim()) {
      setError("Enter a test email or phone to send yourself a preview.");
      return;
    }
    if (
      !test &&
      !window.confirm(
        `Send this to ${
          [
            sendEmail ? `${status?.counts.email ?? "?"} by email` : "",
            sendSms ? `${status?.counts.sms ?? "?"} by text` : "",
          ]
            .filter(Boolean)
            .join(" and ")
        }? This goes out immediately.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin-broadcast", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          leagueId,
          subject,
          message,
          sendEmail,
          sendSms,
          ageGroup: ageGroup || undefined,
          testEmail: test ? testEmail : undefined,
          testPhone: test ? testPhone : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, any>;
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const parts: string[] = [];
      if (data.email)
        parts.push(
          data.email.skipped
            ? "Email: not set up yet"
            : `Email: ${data.email.sent ?? 0} sent${data.email.error ? ` (${data.email.error})` : ""}`,
        );
      if (data.sms)
        parts.push(
          data.sms.skipped
            ? "Text: not set up yet"
            : `Text: ${data.sms.sent ?? 0} sent${data.sms.failed ? `, ${data.sms.failed} failed` : ""}`,
        );
      setResult(`${test ? "Test sent. " : "Sent! "}${parts.join(" · ")}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setBusy(false);
    }
  }

  const box: React.CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: 16,
    background: "#fff",
  };
  const input: React.CSSProperties = {
    width: "100%",
    padding: "9px 11px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    fontSize: 14,
  };

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 640 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Send Message</div>
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
          Email + text your Alerts sign-up list — rainouts, reminders, deadlines.
        </div>
      </div>

      {status && !status.emailConfigured && !status.smsConfigured && (
        <div
          style={{
            ...box,
            background: "rgba(245,200,66,0.12)",
            borderColor: "rgba(245,200,66,0.5)",
            fontSize: 13,
          }}
        >
          <strong>Not connected yet.</strong> Sending turns on once the SendGrid
          (email) and Twilio (text) keys are added to the site. You can still
          compose here.
        </div>
      )}

      <div style={box}>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700 }}>
              Subject (email)
            </label>
            <input
              style={input}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Games cancelled tonight"
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700 }}>Message</label>
            <textarea
              style={{ ...input, minHeight: 120, resize: "vertical" }}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your announcement…"
            />
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              Texts append “Reply STOP to opt out.” automatically.
            </div>
          </div>

          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: 6, fontSize: 14 }}>
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
              />
              Email{" "}
              {status ? (
                <span style={{ color: "var(--muted)" }}>
                  ({status.counts.email})
                </span>
              ) : null}
            </label>
            <label style={{ display: "flex", gap: 6, fontSize: 14 }}>
              <input
                type="checkbox"
                checked={sendSms}
                onChange={(e) => setSendSms(e.target.checked)}
              />
              Text{" "}
              {status ? (
                <span style={{ color: "var(--muted)" }}>
                  ({status.counts.sms})
                </span>
              ) : null}
            </label>
            {status && status.ageGroups.length > 0 && (
              <label style={{ display: "flex", gap: 6, fontSize: 14 }}>
                Age group:
                <select
                  value={ageGroup}
                  onChange={(e) => setAgeGroup(e.target.value)}
                  style={{ ...input, width: "auto", padding: "4px 8px" }}
                >
                  <option value="">All</option>
                  {status.ageGroups.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      </div>

      <div style={box}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
          Send yourself a test first
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            style={{ ...input, flex: 1, minWidth: 180 }}
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="your@email.com"
          />
          <input
            style={{ ...input, flex: 1, minWidth: 160 }}
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="(614) 555-0123"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => send(true)}
            style={{
              padding: "9px 16px",
              borderRadius: 8,
              border: "1px solid var(--brand-primary)",
              background: "#fff",
              color: "var(--brand-primary)",
              fontWeight: 700,
              cursor: busy ? "default" : "pointer",
            }}
          >
            Send test
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: "var(--red)", fontSize: 14 }}>{error}</div>
      )}
      {result && (
        <div style={{ color: "var(--green, #16a34a)", fontSize: 14, fontWeight: 600 }}>
          {result}
        </div>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => send(false)}
        style={{
          padding: "12px 20px",
          borderRadius: 10,
          border: "none",
          background: "var(--brand-primary)",
          color: "#fff",
          fontWeight: 800,
          fontSize: 15,
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
          justifySelf: "start",
        }}
      >
        {busy ? "Sending…" : "Send to everyone"}
      </button>
    </div>
  );
}

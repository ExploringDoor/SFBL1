"use client";

// Admin "Send Message" — email + text blast to the league's contacts.
// Email via SendGrid, text via Twilio (both server-side, env-gated).
// Shows what's wired + a live recipient count, supports a test-send to
// yourself, then a send to everyone.
//
// Two audiences, because they fill up differently: registered coaches come
// in automatically with every team registration (email + phone), while the
// Alerts sign-up list is opt-in from the public /alerts page.

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

interface Props {
  leagueId: string;
  user: User | null;
}

interface Counts {
  total: number;
  email: number;
  sms: number;
}

interface Recipient {
  id: string;
  name: string;
  teamName: string;
  email: string | null;
  ageGroup: string | null;
  source: "coaches" | "subscribers";
  emailable: boolean;
}

interface Status {
  emailConfigured: boolean;
  smsConfigured: boolean;
  counts: Counts;
  sources?: { coaches: Counts; subscribers: Counts };
  recipients?: Recipient[];
  ageGroups: string[];
}

type Source = "all" | "coaches" | "subscribers";

export function BroadcastSection({ leagueId, user }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  // Ids the admin has unticked. "5 people will get it" with no way to see or
  // change who is a blast nobody sends confidently (Adam, 2026-08-12).
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const recipients = status?.recipients ?? [];
  const emailableCount = recipients.filter(
    (r) => r.emailable && !excluded.has(r.id),
  ).length;
  const [source, setSource] = useState<Source>("all");
  const [ageGroup, setAgeGroup] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [sendSms, setSendSms] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testPhone, setTestPhone] = useState("");
  // Mike, 2026-09-10: "there's no way I can send a flyer". Held as a data URL
  // so it survives a re-render, and resized on pick rather than on send: a
  // phone photo is several megabytes and Firestore caps a document at one.
  const [flyer, setFlyer] = useState<string>("");
  const [flyerName, setFlyerName] = useState<string>("");
  const [flyerNote, setFlyerNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const qs = new URLSearchParams({ leagueId, source });
      if (ageGroup) qs.set("ageGroup", ageGroup);
      const res = await fetch(`/api/admin-broadcast?${qs.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.ok) setStatus((await res.json()) as Status);
    } catch {
      /* ignore — the form still works, just no live count */
    }
  }, [leagueId, user, ageGroup, source]);

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
            sendEmail ? `${emailableCount} by email` : "",
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
          source,
          ageGroup: ageGroup || undefined,
          testEmail: test ? testEmail : undefined,
          testPhone: test ? testPhone : undefined,
          excludeIds: [...excluded],
          flyer: flyer || undefined,
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
      // A fetch that dies at the network throws TypeError, and its message is
      // whatever the browser feels like: Safari says "Load failed", Chrome
      // says "Failed to fetch". Neither tells the office anything, and Mike
      // got exactly that on 2026-09-10 sending a flyer. Say what it means and
      // what to do about it.
      const raw = e instanceof Error ? e.message : "";
      const networkish = /load failed|failed to fetch|networkerror|timed out/i.test(raw);
      setError(
        networkish
          ? "The message did not reach the server. That is usually the connection, and a flyer makes the request bigger. Check your signal and try again, or send it without the flyer."
          : raw || "Send failed.",
      );
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

  /**
   * Shrink the picked image so it fits a Firestore document.
   *
   * A flyer straight off a phone is 3-6MB and the cap is 1MB before base64
   * inflates it by a third. 1200px wide is more than any mail client will
   * show, and JPEG at 0.82 keeps text on a flyer readable.
   */
  async function pickFlyer(file: File) {
    setFlyerNote(null);
    if (!file.type.startsWith("image/")) {
      setFlyerNote("That needs to be an image. A PDF will not show inside the email.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      // 1000px, not 1200. Email renders a flyer at about 560px wide, so this
      // is already 2x for a retina screen, and the smaller the POST the more
      // likely it survives a phone connection.
      const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
      const w = Math.round(bitmap.width * scale);
      const h = Math.round(bitmap.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      // White behind it: a transparent PNG on a white email background is
      // fine, but on a dark client it turns into unreadable dark-on-dark.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      // Step down until it fits. Quality first, then size: a flyer is mostly
      // flat colour and large type, which survives heavy JPEG compression far
      // better than a photograph would.
      let url = canvas.toDataURL("image/jpeg", 0.8);
      for (const q of [0.65, 0.5, 0.4]) {
        if (url.length <= 320_000) break;
        url = canvas.toDataURL("image/jpeg", q);
      }
      if (url.length > 320_000) {
        setFlyerNote("That image is too big even after shrinking. Try a smaller one.");
        return;
      }
      setFlyer(url);
      setFlyerName(file.name);
      setFlyerNote(`Ready to send, ${Math.round(url.length / 1024)}KB.`);
    } catch {
      setFlyerNote("Could not read that image. Try a JPG or PNG.");
    }
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 640 }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Send Message</div>
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
          Email + text your coaches and subscribers — rainouts, reminders,
          deadlines.
        </div>
      </div>

      <div style={box}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
          Who gets this
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {(
            [
              {
                key: "all" as const,
                label: "Everyone",
                note: "Registered coaches and alert sign-ups",
                counts: status?.counts,
              },
              {
                key: "coaches" as const,
                label: "Registered coaches",
                note: "Added automatically when a team registers",
                counts: status?.sources?.coaches,
              },
              {
                key: "subscribers" as const,
                label: "Alert sign-ups",
                note: "People who opted in on the Alerts page",
                counts: status?.sources?.subscribers,
              },
            ]
          ).map((opt) => (
            <label
              key={opt.key}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                fontSize: 14,
                padding: "8px 10px",
                borderRadius: 8,
                border:
                  source === opt.key
                    ? "1px solid var(--brand-primary)"
                    : "1px solid var(--border)",
                background:
                  source === opt.key ? "rgba(0,45,114,0.04)" : "transparent",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="broadcast-source"
                checked={source === opt.key}
                onChange={() => setSource(opt.key)}
                style={{ marginTop: 3 }}
              />
              <span>
                <span style={{ fontWeight: 700 }}>{opt.label}</span>
                {opt.counts && (
                  <span style={{ color: "var(--muted)" }}>
                    {" "}
                    — {opt.counts.email} email
                    {opt.counts.sms > 0 ? `, ${opt.counts.sms} text` : ""}
                  </span>
                )}
                <span
                  style={{
                    display: "block",
                    fontSize: 12,
                    color: "var(--muted)",
                  }}
                >
                  {opt.note}
                </span>
              </span>
            </label>
          ))}
        </div>
        {status && status.counts.total === 0 && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
            No contacts yet. The list fills in on its own — every team that
            registers adds its head coach, and anyone can opt in from the
            Alerts page.
          </div>
        )}
      </div>

      {recipients.length > 0 && (
        <div style={box}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 10,
            }}
          >
            <strong style={{ fontSize: 13 }}>
              Who gets this ({emailableCount} of{" "}
              {recipients.filter((r) => r.emailable).length})
            </strong>
            <span style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => setExcluded(new Set())}
                style={{ fontSize: 12, textDecoration: "underline" }}
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => setExcluded(new Set(recipients.map((r) => r.id)))}
                style={{ fontSize: 12, textDecoration: "underline" }}
              >
                Clear all
              </button>
            </span>
          </div>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              maxHeight: 260,
              overflowY: "auto",
              display: "grid",
              gap: 2,
            }}
          >
            {recipients.map((r) => {
              const on = r.emailable && !excluded.has(r.id);
              return (
                <li key={r.id}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "7px 8px",
                      borderRadius: 6,
                      fontSize: 13,
                      minHeight: 40,
                      opacity: r.emailable ? 1 : 0.55,
                      cursor: r.emailable ? "pointer" : "not-allowed",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!r.emailable}
                      onChange={() =>
                        setExcluded((prev) => {
                          const next = new Set(prev);
                          if (next.has(r.id)) next.delete(r.id);
                          else next.add(r.id);
                          return next;
                        })
                      }
                    />
                    <span style={{ fontWeight: 600 }}>{r.name}</span>
                    {r.teamName && (
                      <span style={{ color: "var(--muted)" }}>{r.teamName}</span>
                    )}
                    {r.ageGroup && (
                      <span style={{ color: "var(--muted)" }}>{r.ageGroup}</span>
                    )}
                    <span
                      style={{
                        marginLeft: "auto",
                        color: "var(--muted)",
                        fontSize: 12,
                      }}
                    >
                      {r.emailable ? r.email : "no email on file"}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

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

          {/* Flyer. Shown in the email under the message, and sent as a link
              in the text, because a text cannot carry an image without MMS. */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, display: "block", marginBottom: 4 }}>
              Flyer (optional)
            </label>
            {flyer ? (
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={flyer}
                  alt="Flyer preview"
                  style={{
                    width: 150,
                    height: "auto",
                    borderRadius: 6,
                    border: "1px solid rgba(0,0,0,0.15)",
                  }}
                />
                <div>
                  <div style={{ fontSize: 12, marginBottom: 6 }}>{flyerName}</div>
                  <button
                    type="button"
                    onClick={() => {
                      setFlyer("");
                      setFlyerName("");
                      setFlyerNote(null);
                    }}
                    style={{
                      fontSize: 12,
                      padding: "5px 10px",
                      borderRadius: 6,
                      border: "1px solid rgba(0,0,0,0.2)",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void pickFlyer(f);
                }}
                style={{ fontSize: 12 }}
              />
            )}
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              A picture of the flyer, JPG or PNG. It shows inside the email, and
              texts get a link to it. Send yourself a test first.
            </div>
            {flyerNote && (
              <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 4 }}>{flyerNote}</div>
            )}
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
            {/* Texting stays visibly off until Twilio keys are added —
                otherwise the box looks usable and a send silently reaches
                nobody. Email being configured hides the global warning. */}
            <label
              style={{
                display: "flex",
                gap: 6,
                fontSize: 14,
                opacity: status && !status.smsConfigured ? 0.55 : 1,
                cursor:
                  status && !status.smsConfigured ? "not-allowed" : "pointer",
              }}
              title={
                status && !status.smsConfigured
                  ? "Texting isn't set up yet — needs a Twilio number."
                  : undefined
              }
            >
              <input
                type="checkbox"
                checked={sendSms && !!status?.smsConfigured}
                disabled={!!status && !status.smsConfigured}
                onChange={(e) => setSendSms(e.target.checked)}
              />
              Text{" "}
              {status ? (
                <span style={{ color: "var(--muted)" }}>
                  {status.smsConfigured
                    ? `(${status.counts.sms})`
                    : "(not set up yet)"}
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

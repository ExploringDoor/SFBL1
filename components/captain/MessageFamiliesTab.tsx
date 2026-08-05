"use client";

// "Message Families" tab — a coach emails their own team's families.
//
// Doug approved this on 2026-08-05, head coach and assistant both. The
// recipient list is never chosen here: the server takes it from the caller's
// own roster, so this UI only writes the subject and body and shows who it
// will reach.
//
// Previews before sending, like the office's unpaid-payment reminder does.
// An email blast cannot be pulled back, so the coach sees the count and the
// names of anyone missing an address before anything goes out.

import { useEffect, useState } from "react";
import { useUser } from "@/lib/auth-client";

interface Props {
  leagueId: string;
}

interface Recipient {
  playerName: string;
  email: string;
}

export function MessageFamiliesTab({ leagueId }: Props) {
  // Same pattern as PaymentsTab: the tab renderer does not thread the user
  // down, so take it from the auth hook.
  const user = useUser();
  const [loading, setLoading] = useState(true);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [skipped, setSkipped] = useState<{ playerName: string }[]>([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function call(action: "preview" | "send") {
    if (!user) throw new Error("not signed in");
    const idToken = await user.getIdToken();
    const res = await fetch("/api/captain-message", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ leagueId, action, subject, message }),
    });
    return (await res.json()) as {
      ok?: boolean;
      recipients?: Recipient[];
      skipped?: { playerName: string }[];
      sent?: number;
      failed?: { email: string; error: string }[];
      error?: string;
    };
  }

  useEffect(() => {
    // useUser() is undefined on the first render while auth resolves. Waiting
    // for it matters: keyed on [leagueId] alone this ran once with no user,
    // threw, and never retried — the tab just said "0 families" forever.
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await call("preview");
        if (cancelled) return;
        if (r.error) setMsg({ ok: false, text: r.error });
        setRecipients(r.recipients ?? []);
        setSkipped(r.skipped ?? []);
      } catch {
        if (!cancelled) setMsg({ ok: false, text: "Couldn't load your roster." });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, user]);

  async function send() {
    if (!subject.trim()) return setMsg({ ok: false, text: "Add a subject." });
    if (!message.trim()) return setMsg({ ok: false, text: "Add a message." });
    const n = recipients.length;
    if (n === 0)
      return setMsg({
        ok: false,
        text: "No family email addresses on your roster yet. Add them on the Roster tab.",
      });
    const ok = window.confirm(
      `Send this to ${n} famil${n === 1 ? "y" : "ies"} on your roster?` +
        (skipped.length
          ? `\n\n${skipped.length} player(s) have no email on file and will be skipped.`
          : ""),
    );
    if (!ok) return;

    setSending(true);
    setMsg(null);
    try {
      const r = await call("send");
      if (r.error) {
        setMsg({ ok: false, text: r.error });
        return;
      }
      const failed = r.failed ?? [];
      setMsg({
        ok: failed.length === 0,
        text:
          `Sent to ${r.sent ?? 0} famil${r.sent === 1 ? "y" : "ies"}.` +
          (failed.length ? ` ${failed.length} didn't go through.` : ""),
      });
      if (failed.length === 0) {
        setSubject("");
        setMessage("");
      }
    } catch {
      setMsg({ ok: false, text: "Couldn't send. Try again in a moment." });
    } finally {
      setSending(false);
    }
  }

  if (loading)
    return (
      <div className="cap-tab">
        <p style={{ color: "var(--muted)" }}>Loading your roster…</p>
      </div>
    );

  return (
    <div className="cap-tab">
      <div className="cap-section-head">
        <h2 className="cap-section-title">Message Families</h2>
        <p className="cap-section-sub">
          Send one email to every family on your roster. Replies come straight
          back to you, not to the league.
        </p>
      </div>

      {msg && (
        <p
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            fontSize: 14,
            background: msg.ok ? "#e6f1ea" : "#f9ebe6",
            color: msg.ok ? "#2c6444" : "#9c3a24",
          }}
        >
          {msg.text}
        </p>
      )}

      <p style={{ fontSize: 14, color: "var(--muted)", margin: "10px 0 4px" }}>
        Goes to <strong>{recipients.length}</strong> famil
        {recipients.length === 1 ? "y" : "ies"}.
        {skipped.length > 0 && (
          <>
            {" "}
            <span style={{ color: "#9c3a24" }}>
              {skipped.length} player{skipped.length === 1 ? "" : "s"} ha
              {skipped.length === 1 ? "s" : "ve"} no email on file
            </span>{" "}
            — add one on the Roster tab and they&rsquo;ll be included next time.
          </>
        )}
      </p>

      <div className="cap-form-row" style={{ marginTop: 12 }}>
        <div className="cap-form-col" style={{ flex: "1 1 100%" }}>
          <label className="cap-form-lbl">Subject</label>
          <input
            className="cap-form-input"
            value={subject}
            maxLength={140}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Practice moved to Thursday"
          />
        </div>
      </div>
      <div className="cap-form-row">
        <div className="cap-form-col" style={{ flex: "1 1 100%" }}>
          <label className="cap-form-lbl">Message</label>
          <textarea
            className="cap-form-input"
            value={message}
            maxLength={5000}
            rows={9}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              "Hi everyone,\n\nThursday's practice moves to 6pm at the main diamond. Bring a red jersey.\n\nThanks"
            }
          />
        </div>
      </div>

      <div className="cap-form-actions" style={{ marginTop: 8 }}>
        <button
          type="button"
          onClick={send}
          disabled={sending}
          className="le-cap-btn-primary"
          style={{
            padding: "10px 20px",
            borderRadius: 8,
            border: 0,
            fontWeight: 700,
            fontSize: 14,
            cursor: sending ? "default" : "pointer",
            opacity: sending ? 0.6 : 1,
          }}
        >
          {sending ? "Sending…" : "Send to families"}
        </button>
      </div>

      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 14 }}>
        Each family gets their own copy, so nobody sees anyone else&rsquo;s email
        address. The league office gets a copy of what you send.
      </p>
    </div>
  );
}

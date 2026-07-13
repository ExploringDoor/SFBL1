"use client";

// Sign-in page. Drop-in branded version of the auth flow — uses the
// league's primary color, banner, and copy. No password — Firebase
// magic-link only. Email goes in, the link arrives, the user clicks
// the link, /login/finish does the redirect to /admin or /captain
// or /profile based on their role claim.
//
// iOS PWA gotcha: tapping the magic link from the email app on an
// iPhone always opens Safari, never the installed PWA. Apple
// doesn't expose Android-style manifest URL claiming. And the
// PWA's auth context is isolated from Safari's — signing in there
// doesn't sign you in here. We show an extra warning in standalone
// mode so the user knows to either (a) sign in from Safari and
// browse there, or (b) wait for the cross-context bridge we'll
// build next.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendMagicLink, signInWithBridgeToken } from "@/lib/auth-client";
import { useTenant } from "@/lib/tenant-context";
import { captainNoun } from "@/lib/tenants";

// Local-storage key the PWA uses to remember which bridgeId it's
// polling for, so a quick reload of /login picks up where it left
// off instead of stranding the user with the magic link they just
// requested.
const BRIDGE_ID_KEY = "leagueplatform:authBridgeId";

function newBridgeId(): string {
  // crypto.randomUUID() is available in Safari 15.4+ / Chrome 92+ —
  // every browser that can render Next 14. Cast-via-unknown lets
  // TS accept the call without forcing us to depend on lib.dom.d.ts
  // version mismatches between local and Vercel.
  const c = crypto as unknown as { randomUUID?: () => string };
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  buf[6] = (buf[6]! & 0x0f) | 0x40;
  buf[8] = (buf[8]! & 0x3f) | 0x80;
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

export default function LoginPage() {
  const { tenantId, config } = useTenant();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<
    "off" | "waiting" | "claimed"
  >("off");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(display-mode: standalone)");
    const update = () =>
      setIsStandalone(
        mq.matches ||
          // @ts-expect-error iOS-only legacy property
          window.navigator.standalone === true,
      );
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  // Bridge poller. Active only when the PWA has a bridgeId stored
  // AND the user has actually submitted the magic-link form (or
  // we recovered an in-flight bridgeId from a reload). Hits
  // /api/auth-bridge/claim every 1.5s; once Safari completes the
  // sign-in, the create endpoint plants a custom token, we
  // signInWithCustomToken locally, and redirect.
  const pollingRef = useRef<number | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (status !== "sent") return;
    const bridgeId = window.localStorage.getItem(BRIDGE_ID_KEY);
    if (!bridgeId) return;
    setBridgeStatus("waiting");

    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch("/api/auth-bridge/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bridgeId }),
        });
        if (cancelled) return;
        if (res.status === 200) {
          const data = (await res.json()) as { token?: string };
          if (data.token) {
            window.localStorage.removeItem(BRIDGE_ID_KEY);
            await signInWithBridgeToken(data.token);
            if (!cancelled) {
              setBridgeStatus("claimed");
              router.push("/");
            }
            return;
          }
        }
        // 404 or no token → keep polling
        pollingRef.current = window.setTimeout(tick, 1500);
      } catch {
        pollingRef.current = window.setTimeout(tick, 3000);
      }
    }
    pollingRef.current = window.setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      if (pollingRef.current != null) {
        window.clearTimeout(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [status, router]);

  const useEmulator =
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("sending");
    try {
      // Only set up a bridge when we're running as a standalone
      // PWA — in a regular browser the magic link already lands
      // back in this same context, no handoff needed. The bridgeId
      // hits localStorage BEFORE we await sendMagicLink so a slow
      // network can't strand us with an email that references an
      // id we forgot.
      let bridgeId: string | undefined;
      if (isStandalone) {
        bridgeId = newBridgeId();
        window.localStorage.setItem(BRIDGE_ID_KEY, bridgeId);
      }
      await sendMagicLink(email, bridgeId);
      setStatus("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
      setStatus("error");
    }
  }

  const leagueName = config?.name ?? "League";
  const logoUrl = config?.theme?.logo_url ?? null;
  const captain = captainNoun(config);

  return (
    <main
      style={{
        maxWidth: 460,
        margin: "0 auto",
        padding: "48px 20px 64px",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        minHeight: "70vh",
        justifyContent: "center",
      }}
    >
      <header style={{ textAlign: "center" }}>
        {logoUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={logoUrl}
            alt={leagueName}
            style={{
              maxWidth: "70%",
              maxHeight: 96,
              margin: "0 auto 18px",
              display: "block",
              objectFit: "contain",
            }}
          />
        )}
        <h1
          className="font-display"
          style={{
            fontSize: 32,
            fontWeight: 900,
            color: "var(--text-strong)",
            margin: "0 0 6px",
            letterSpacing: "-0.01em",
          }}
        >
          Sign in
        </h1>
        <p
          style={{
            color: "var(--muted)",
            fontSize: 14,
            lineHeight: 1.55,
            margin: 0,
          }}
        >
          {captain}s and players sign in by email — no password. Enter
          your email, we&rsquo;ll send a one-tap link.
        </p>
      </header>

      {isStandalone && status === "idle" && (
        <div
          style={{
            background: "rgba(0, 45, 114, 0.06)",
            border: "1px solid rgba(0, 45, 114, 0.18)",
            borderRadius: 12,
            padding: "12px 14px",
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--text-strong)",
          }}
        >
          <strong style={{ fontWeight: 700 }}>iPhone tip:</strong> tapping the
          email link will open Safari (Apple limitation). Sign in there, then
          come back to this app — it&rsquo;ll pick up your sign-in
          automatically.
        </div>
      )}

      {status !== "sent" ? (
        <form
          onSubmit={onSubmit}
          style={{
            background: "white",
            border: "1px solid rgba(0, 0, 0, 0.07)",
            borderRadius: 14,
            padding: "20px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                fontFamily: "inherit",
                fontSize: 16,
                padding: "10px 12px",
                border: "1px solid rgba(0, 0, 0, 0.15)",
                borderRadius: 8,
                background: "white",
                color: "var(--text-strong)",
                textTransform: "none",
                letterSpacing: 0,
                fontWeight: 400,
              }}
            />
          </label>
          <button
            type="submit"
            disabled={status === "sending"}
            style={{
              background: "var(--brand-primary)",
              color: "white",
              border: "none",
              padding: "12px 20px",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 800,
              fontFamily: "inherit",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              cursor: "pointer",
              opacity: status === "sending" ? 0.7 : 1,
              transition: "filter 0.15s ease",
            }}
          >
            {status === "sending" ? "Sending…" : "Send sign-in link"}
          </button>
          {error && (
            <p
              style={{
                fontSize: 13,
                color: "#991b1b",
                background: "rgba(220, 38, 38, 0.08)",
                border: "1px solid rgba(220, 38, 38, 0.25)",
                borderRadius: 8,
                padding: "8px 12px",
                margin: 0,
              }}
            >
              {error}
            </p>
          )}
        </form>
      ) : (
        <section
          style={{
            background: "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(0,45,114,0.06))",
            border: "1px solid rgba(16, 185, 129, 0.25)",
            borderRadius: 14,
            padding: "24px 22px",
            textAlign: "center",
          }}
        >
          <div aria-hidden style={{ fontSize: 40, marginBottom: 8 }}>
            ✉️
          </div>
          <h2
            style={{
              fontFamily: "var(--font-barlow), sans-serif",
              fontSize: 20,
              fontWeight: 800,
              color: "#047857",
              margin: "0 0 6px",
            }}
          >
            Check your email
          </h2>
          <p
            style={{
              color: "var(--text-strong)",
              fontSize: 14,
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            A sign-in link has been sent to{" "}
            <strong style={{ fontWeight: 700 }}>{email}</strong>. Tap it
            from your phone or laptop and you&rsquo;ll be signed in
            automatically.
          </p>
          {isStandalone && bridgeStatus === "waiting" && (
            <p
              style={{
                marginTop: 14,
                fontSize: 12,
                color: "var(--muted)",
                lineHeight: 1.55,
              }}
            >
              <span aria-hidden style={{ marginRight: 6 }}>
                ⏳
              </span>
              Waiting for Safari sign-in… once you tap the link there, this
              app will sign in automatically. Keep this screen open.
            </p>
          )}
          {bridgeStatus === "claimed" && (
            <p
              style={{
                marginTop: 14,
                fontSize: 13,
                color: "#047857",
                lineHeight: 1.5,
                fontWeight: 700,
              }}
            >
              ✓ Signed in — redirecting…
            </p>
          )}
          {useEmulator && (
            <p
              style={{
                marginTop: 14,
                padding: "8px 12px",
                background: "rgba(217, 119, 6, 0.08)",
                border: "1px solid rgba(217, 119, 6, 0.3)",
                borderRadius: 8,
                fontSize: 11,
                color: "#92400e",
                lineHeight: 1.45,
              }}
            >
              <strong>Emulator mode:</strong> real email isn&rsquo;t
              sent. Open{" "}
              <a
                href="http://localhost:4000/auth"
                style={{
                  fontFamily: "ui-monospace, monospace",
                  textDecoration: "underline",
                  color: "inherit",
                }}
                target="_blank"
                rel="noreferrer"
              >
                localhost:4000/auth
              </a>{" "}
              and click the pending sign-in link.
            </p>
          )}
        </section>
      )}

      {tenantId && (
        <footer
          style={{
            textAlign: "center",
            fontSize: 11,
            color: "var(--muted)",
          }}
        >
          {leagueName}
        </footer>
      )}
    </main>
  );
}

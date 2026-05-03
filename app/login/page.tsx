"use client";

import { useState } from "react";
import { sendMagicLink } from "@/lib/auth-client";
import { useTenant } from "@/lib/tenant-context";

export default function LoginPage() {
  const { tenantId, config } = useTenant();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const useEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("sending");
    try {
      await sendMagicLink(email);
      setStatus("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
      setStatus("error");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
        {config?.name ? (
          <p className="text-slate-600">{config.name}</p>
        ) : (
          <p className="text-slate-600">League Platform</p>
        )}
      </header>

      {status !== "sent" ? (
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              placeholder="you@example.com"
            />
          </label>
          <button
            type="submit"
            disabled={status === "sending"}
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
          >
            {status === "sending" ? "Sending…" : "Send sign-in link"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      ) : (
        <section className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
          <p className="font-semibold text-slate-900">Check your email.</p>
          <p className="text-slate-700">
            A sign-in link has been sent to <span className="font-mono">{email}</span>.
            Click it to finish signing in.
          </p>
          {useEmulator && (
            <p className="text-xs text-amber-700">
              Emulator mode: real email isn't sent. Open the Auth Emulator UI at{" "}
              <a
                href="http://localhost:4000/auth"
                className="font-mono underline"
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

      <footer className="text-xs text-slate-400">
        {tenantId ? (
          <>tenant: <span className="font-mono">{tenantId}</span></>
        ) : (
          <>no tenant context — bare apex</>
        )}
      </footer>
    </main>
  );
}

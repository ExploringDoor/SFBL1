"use client";

// Tiny "what version are you on?" pill. Asks the active service
// worker for its CACHE_VERSION via postMessage and renders it in a
// fixed bottom-right corner of the page. DVSL pattern — turned out
// to be invaluable when fielding "I don't see your fix" reports
// because we could ask the captain for the version string and know
// definitively whether they had the new build.
//
// Hidden when:
//   - No SW controller (fresh install before SW activates)
//   - VERSION reply doesn't come back within 1.5s
//   - Running in non-standalone mode AND user is at "/" (no point
//     spamming the homepage; the pill is for debugging in-app
//     issues)
//
// Tap-and-hold copies the version to clipboard so support can paste
// it into a chat without retyping.

import { useEffect, useState } from "react";

export function SwVersionPill() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let canceled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    async function ask() {
      const reg = await navigator.serviceWorker.ready;
      const ctrl = reg.active || navigator.serviceWorker.controller;
      if (!ctrl) return;

      // MessageChannel-based reply so we don't have to add a global
      // controller-message handler that would receive replies meant
      // for other features. Each request gets its own port.
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => {
        if (canceled) return;
        if (e.data && e.data.type === "VERSION" && typeof e.data.version === "string") {
          setVersion(e.data.version);
        }
      };
      try {
        ctrl.postMessage({ type: "GET_VERSION" }, [channel.port2]);
      } catch (_) {
        /* SW gone? give up silently. */
      }
      timeout = setTimeout(() => {
        try {
          channel.port1.close();
        } catch (_) {}
      }, 1500);
    }

    void ask();
    return () => {
      canceled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  if (!version) return null;

  function copy() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(version!).catch(() => {});
    }
  }

  return (
    <div
      role="status"
      aria-label={`App version ${version}`}
      onClick={copy}
      title="Tap to copy version"
      style={{
        position: "fixed",
        right: 8,
        // Sit above the PWA tab bar (when present) so it doesn't
        // overlap. has-tabbar adds bottom padding to body via
        // PwaTabBar.css; we add the same offset here.
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 6px)",
        padding: "3px 8px",
        background: "rgba(0, 0, 0, 0.55)",
        color: "rgba(255, 255, 255, 0.85)",
        borderRadius: 999,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.04em",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', monospace",
        zIndex: 99990,
        pointerEvents: "auto",
        userSelect: "none",
        cursor: "pointer",
      }}
    >
      {version}
    </div>
  );
}

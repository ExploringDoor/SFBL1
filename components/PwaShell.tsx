"use client";

// PWA shell client component. Mounted from the root layout so every
// page gets:
//
//   1. Service worker registration on first load (so push works AND
//      offline cache primes), independent of whether the user has
//      enabled push notifications. Without this the SW only registers
//      on the first push-enable click, which means a user who never
//      enables push never gets the offline cache or install prompt.
//
//   2. `beforeinstallprompt` capture + a small Install button shown
//      in the corner once the browser deems the site "installable"
//      (HTTPS, valid manifest, registered SW, return visit).
//
// iOS doesn't fire `beforeinstallprompt` — Apple disabled it. iOS
// users have to use Safari → Share → Add to Home Screen manually.
// We surface a one-time tip the first time iOS Safari hits the page,
// dismissible forever via localStorage.

import { useEffect, useState } from "react";

const SW_PATH = "/firebase-messaging-sw.js";
const IOS_TIP_DISMISSED_KEY = "leagueplatform:iosInstallTipDismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaShell() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosTipVisible, setIosTipVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. Register SW (idempotent — Chrome dedupes).
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register(SW_PATH)
        .catch((e) => console.warn("[PwaShell] SW register failed:", e));
    }

    // 2. beforeinstallprompt — modern browsers (Chrome, Edge, Brave).
    function onBeforeInstall(e: Event) {
      e.preventDefault(); // don't show the default mini-prompt
      setInstallEvent(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setInstallEvent(null);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // 3. iOS Safari — no `beforeinstallprompt`. Show a one-time tip
    // unless they've dismissed it OR they're already in standalone
    // mode (already installed).
    type IosNav = Navigator & { standalone?: boolean };
    const ua = navigator.userAgent || "";
    const isIos = /iPad|iPhone|iPod/.test(ua);
    const inStandalone =
      (window.navigator as IosNav).standalone === true ||
      (window.matchMedia &&
        window.matchMedia("(display-mode: standalone)").matches);
    if (isIos && !inStandalone) {
      try {
        const dismissed = window.localStorage.getItem(
          IOS_TIP_DISMISSED_KEY,
        );
        if (!dismissed) setIosTipVisible(true);
      } catch {
        /* private mode — just don't show */
      }
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "accepted") {
      setInstalled(true);
    }
    setInstallEvent(null);
  }

  function dismissIosTip() {
    setIosTipVisible(false);
    try {
      window.localStorage.setItem(IOS_TIP_DISMISSED_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  if (installed) return null;

  if (installEvent) {
    return (
      <button
        type="button"
        onClick={handleInstall}
        className="pwa-install-cta"
        title="Install this app to your home screen"
      >
        ⬇ Install app
      </button>
    );
  }

  if (iosTipVisible) {
    return (
      <div className="pwa-ios-tip" role="status">
        <div className="pwa-ios-tip-body">
          <strong>Install this app</strong>
          <p>
            Tap <span aria-label="share">⬆️</span> Share, then{" "}
            <strong>Add to Home Screen</strong>. Push notifications only
            work once installed.
          </p>
        </div>
        <button
          type="button"
          className="pwa-ios-tip-dismiss"
          onClick={dismissIosTip}
          aria-label="Dismiss install tip"
        >
          ×
        </button>
      </div>
    );
  }

  return null;
}

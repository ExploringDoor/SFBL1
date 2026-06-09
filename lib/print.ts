// Printing helper.
//
// The catch: window.print() is a NO-OP inside an iOS standalone PWA
// (the installed web app). Safari in standalone display-mode has no
// print/share-to-PDF pipeline, so the button appeared to "do nothing"
// (Adam, 2026-06). Desktop browsers and regular mobile Safari are
// fine — they show the print dialog with a "Save as PDF" option.
//
// Fix: when we detect iOS-standalone, re-open the SAME page in a fresh
// browser tab with ?autoprint=1. That new tab is a normal browser
// context (not standalone) where print works, and the page's
// auto-print effect fires the dialog on load. Everywhere else we just
// call window.print() directly.

export function isStandalonePWA(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    // iOS legacy, non-standard
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Mac; disambiguate via touch points.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Trigger printing in a way that also works from the installed app. */
export function triggerPrint(): void {
  if (typeof window === "undefined") return;
  // Only iOS-standalone needs the escape hatch; Android PWAs and all
  // browsers print fine in place.
  if (isStandalonePWA() && isIOS()) {
    const url = new URL(window.location.href);
    url.searchParams.set("autoprint", "1");
    window.open(url.toString(), "_blank");
    return;
  }
  window.print();
}

/** Returns true if the current URL asked for an automatic print
 *  (used by pages that auto-fire the dialog when opened as the
 *  standalone fallback tab). */
export function wantsAutoPrint(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("autoprint") === "1";
}

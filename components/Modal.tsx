"use client";

// Centered dialog modal used by the @modal parallel route. Closes via
// Esc key, click outside, or the close button. Uses router.back() so
// modal close pops the modal route while keeping the underlying page
// (e.g. /scores) intact.
//
// Also intercepts internal Link clicks: when a user clicks a link
// inside the modal that navigates AWAY from the current URL, close the
// modal first so the new page renders cleanly.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function Modal({ children, title }: { children: React.ReactNode; title?: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Closes H12. Focus management for keyboard + screen-reader users.
  //   - On open: remember the element that triggered the modal,
  //     then move focus inside the dialog (close button is a safe
  //     anchor that's always present).
  //   - On close: restore focus to the trigger so the keyboard
  //     user doesn't lose their place.
  //   - While open: trap Tab inside the dialog (cycle from last
  //     focusable element to first and vice-versa).
  //
  // Standard WAI-ARIA dialog pattern; without it Tab cycled out
  // into the (visually-inert) page underneath, which screen readers
  // would happily read aloud.
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Snapshot the element that had focus when the modal opened.
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    // Move focus into the dialog. A tiny defer lets React commit
    // the DOM first.
    queueMicrotask(() => closeBtnRef.current?.focus());

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        router.back();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        // The standard tabbable-elements heuristic. Disabled inputs +
        // tabindex=-1 are intentionally excluded.
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    // Lock background scroll. Compensate for the missing scrollbar
    // width so the page doesn't visibly shift when the modal opens.
    const sw = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    if (sw > 0) document.body.style.paddingRight = `${sw}px`;
    // DVSL pattern (~/Desktop/softball-site/index.html line 7382):
    // when a fullscreen modal opens, push the ticker off-screen and
    // hide the nav so the modal owns the viewport top — otherwise the
    // fixed bars cover the modal's logos/title/close button.
    document.body.classList.add("ticker-force-hide", "dvsl-modal-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      document.body.classList.remove("ticker-force-hide", "dvsl-modal-open");
      // Restore focus on close. Defer to the next tick so the
      // modal's DOM is fully detached first.
      const toFocus = previousFocusRef.current;
      if (toFocus && typeof toFocus.focus === "function") {
        queueMicrotask(() => toFocus.focus());
      }
    };
  }, [router]);

  function onBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) router.back();
  }

  // Intercept clicks on internal anchors. A click on a Link that
  // navigates to a different URL should close the modal first so the
  // new page renders without the modal stuck on top.
  function onContentClick(e: React.MouseEvent) {
    const target = (e.target as HTMLElement | null)?.closest("a") as
      | HTMLAnchorElement
      | null;
    if (!target) return;
    const href = target.getAttribute("href");
    if (!href || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#")) {
      return;
    }
    // Internal nav — close the modal, then push to the destination.
    e.preventDefault();
    router.back();
    setTimeout(() => router.push(href), 50);
  }

  return (
    <div
      onClick={onBackdropClick}
      className="fixed inset-0 z-[800] flex items-start justify-center bg-black/50 p-4 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={dialogRef}
        className="relative my-8 w-full max-w-3xl rounded-lg bg-white shadow-2xl"
        onClick={onContentClick}
      >
        <button
          ref={closeBtnRef}
          type="button"
          onClick={() => router.back()}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-md bg-slate-100 px-2 py-1 text-sm text-slate-600 hover:bg-slate-200"
        >
          ✕
        </button>
        <div className="max-h-[90vh] overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

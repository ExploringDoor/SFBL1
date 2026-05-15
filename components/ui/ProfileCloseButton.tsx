"use client";

// Tiny client component used as the "✕" in PlayerProfileLBDC's
// header bar. PlayerProfileLBDC is server-rendered, so the close
// behaviour (router.back() to dismiss the intercepted modal) has to
// live in a client island. Outside the modal route the parent
// doesn't render this component, so it's modal-only by construction.

import { useRouter } from "next/navigation";

export function ProfileCloseButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Close"
      className="le-prof-close"
    >
      ✕
    </button>
  );
}

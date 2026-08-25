"use client";

// The College Clinic offer, shown on arrival.
//
// Adam asked for this (2026-08-18): a popup as soon as you enter the site,
// with a Register button and a Continue to site option. Mike printed
// "REGISTER AT ISLANDFASTPITCH.COM" on the flyer, so the site has to make the
// clinic impossible to miss for a few weeks.
//
// ONCE PER VISIT, which was Adam's call from three options. sessionStorage,
// not localStorage: it comes back on a genuinely new visit, so a parent who
// dismissed it in August still meets it again in September, but it does not
// reappear while they are checking a score for the third time this morning.
//
// IT TAKES ITSELF DOWN. clinicIsOver() stops it at 2 PM Eastern on 12 October,
// the same instant the page and the card path close, with nothing to remember
// and nothing to deploy. The page stays reachable so an old link
// still lands somewhere sensible.
//
// Deliberately NOT shown on /college-clinic itself. Interrupting someone to
// offer them the page they are already reading is how a popup becomes a joke.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CLINIC, clinicIsOver } from "@/lib/clinic";

const SEEN_KEY = "ifp-clinic-popup-seen";

export function ClinicPopup() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (clinicIsOver()) return;
    if (pathname?.startsWith("/college-clinic")) return;
    // Not on the logged-in work surfaces. The admin is where Mike and Kaitlin
    // run the league and the captain portal is where a coach submits a score
    // after a game; neither is a place to be sold a clinic. Adam found it
    // firing on /admin (2026-08-19).
    if (pathname?.startsWith("/admin")) return;
    if (pathname?.startsWith("/captain")) return;
    // Nor over a payment. /pay/{id} is reached by following a link the office
    // texted or emailed about money that is owed, so the person arriving has
    // already decided what they came to do. Covering that with a flyer for a
    // different event is the worst moment on the site to interrupt, and it
    // covered the "this payment link is not valid" message too, which is the
    // one screen where the visitor most needs to read what it says.
    // Verified on production 2026-08-20.
    if (pathname?.startsWith("/pay/")) return;
    try {
      if (sessionStorage.getItem(SEEN_KEY)) return;
    } catch {
      // Private browsing can throw on storage. Better to show it once more
      // than to crash the home page over a popup.
    }
    // A beat, so it arrives as an offer rather than an ambush mid-paint.
    const t = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(t);
  }, [pathname]);

  // Mark as seen the moment it is shown, not when it is dismissed. Someone who
  // navigates away without touching it has still had their interruption.
  useEffect(() => {
    if (!open) return;
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* see above */
    }
    closeRef.current?.focus();

    // The page behind must not scroll under the dialog.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="le-clinic-pop-backdrop"
      role="presentation"
      // Clicking the dark area is the third way out, alongside Escape and the
      // Continue button. A modal with only one exit is a trap.
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className="le-clinic-pop"
        role="dialog"
        aria-modal="true"
        aria-label="Island Fastpitch College Clinic"
      >
        <button
          ref={closeRef}
          type="button"
          className="le-clinic-pop-x"
          aria-label="Close"
          onClick={() => setOpen(false)}
        >
          ×
        </button>

        {/* The flyer used to be here, as Mike printed it. Taken down
            2026-08-23 with the venue, because it has "LOCATION: ST. JOHN THE
            BAPTIST HS" printed across it and an image is the one place a stale
            claim can sit unnoticed.

            Replaced with the same facts in text rather than deleted outright.
            A popup that interrupts someone and then shows only two buttons has
            not earned the interruption, and this is still the first thing a
            visitor sees. Everything here reads from lib/clinic.ts, so it
            cannot drift from the registration page the way a picture can. */}
        <div className="le-clinic-pop-head">
          <p className="le-clinic-pop-kicker">Island Fastpitch</p>
          <h2 className="le-clinic-pop-title">College Clinic</h2>
          <ul className="le-clinic-pop-facts">
            <li>
              <strong>{CLINIC.dateLabel}</strong>
            </li>
            <li>{CLINIC.timeLabel}</li>
            <li>Open to {CLINIC.ages}</li>
            <li>
              <strong>${CLINIC.fee}</strong> per player &middot;{" "}
              {CLINIC.capacity} player max
            </li>
            <li>{CLINIC.colleges.length} college programs attending</li>
          </ul>
        </div>

        <div className="le-clinic-pop-actions">
          <Link
            href="/college-clinic"
            className="le-clinic-pop-cta"
            onClick={() => setOpen(false)}
          >
            Register for the Clinic
          </Link>
          <button
            type="button"
            className="le-clinic-pop-skip"
            onClick={() => setOpen(false)}
          >
            Continue to site
          </button>
        </div>
      </div>
    </div>
  );
}

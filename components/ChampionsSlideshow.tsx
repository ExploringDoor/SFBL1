"use client";

// Champions strip — a CONSTANT horizontal scroll of championship team photos,
// the same feel as the score ticker (Adam, D27 style). The row glides left at a
// steady pace and loops seamlessly; hovering pauses it so a viewer can stop on
// their team, and every card links through to that season's brackets.
//
// Technique mirrors components/ui/TickerTrack: render the cards twice and animate
// translateX(0 -> -50%), so the second copy lands exactly where the first began.
// Duration is paced by the real pixel width at runtime, so a short archive and a
// long one scroll at the same speed rather than the same duration.
//
// Data is a flat, pre-sorted list of slides (year ascending); slides with no
// photo never reach here — the builder omits them — so every card has an image.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export interface ChampionSlide {
  year: number;
  division: string;
  champion: string;
  runner_up?: string;
  url: string;
  caption: string;
}

// Pixels per second — a touch slower than the ticker (90) because a photo is
// worth lingering on. Overridden only if the row is too short to bother.
const SPEED = 62;

export function ChampionsSlideshow({ slides }: { slides: ChampionSlide[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dur, setDur] = useState(60);

  // Pace the loop by width so speed is constant regardless of how many photos.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => {
      const oneCopy = el.scrollWidth / 2; // two copies live in the track
      if (oneCopy > 0) setDur(Math.max(20, Math.round(oneCopy / SPEED)));
    };
    measure();
    // Re-measure once images have loaded and widened the row.
    const imgs = Array.from(el.querySelectorAll("img"));
    let left = imgs.filter((i) => !i.complete).length;
    if (left === 0) return;
    const onLoad = () => {
      if (--left <= 0) measure();
    };
    imgs.forEach((i) => i.addEventListener("load", onLoad, { once: true }));
    return () =>
      imgs.forEach((i) => i.removeEventListener("load", onLoad));
  }, [slides.length]);

  if (slides.length === 0) return null;

  const Card = ({ s, clone }: { s: ChampionSlide; clone?: boolean }) => (
    <Link
      href={`/history/${s.year}`}
      className="cs-card"
      aria-hidden={clone || undefined}
      tabIndex={clone ? -1 : undefined}
    >
      <span className="cs-card-photo">
        {/* First copy eager so nothing scrolls in blank; the clone lazy-loads
            since it reuses the same (already-cached) URLs. */}
        <img src={s.url} alt={s.caption} loading={clone ? "lazy" : "eager"} />
      </span>
      <span className="cs-card-cap">
        <span className="cs-card-year">{s.year}</span>
        <span className="cs-card-div">{s.division}</span>
        <span className="cs-card-team">{s.champion || "Champion"}</span>
      </span>
    </Link>
  );

  return (
    <section className="cs-marquee" aria-roledescription="carousel" aria-label="League champions">
      <div
        ref={trackRef}
        className="cs-mtrack"
        style={{ animationDuration: `${dur}s` }}
      >
        {slides.map((s, n) => (
          <Card key={n} s={s} />
        ))}
        {/* Seamless-loop clone. */}
        {slides.map((s, n) => (
          <Card key={`c${n}`} s={s} clone />
        ))}
      </div>
    </section>
  );
}

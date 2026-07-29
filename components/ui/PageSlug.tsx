"use client";

// Keeps `data-page` on <html> in sync with the current route's first path
// segment ("/scores" -> "scores", "/" -> "home").
//
// The layout already stamps data-page during SSR, which is what avoids a flash
// of the wrong style on first paint. But the App Router keeps the layout
// mounted across navigations, so that server value goes STALE the moment the
// user clicks a link. Without this, a per-page style (Island's navy scores page)
// would only be right on a hard reload.
//
// Same pattern as PageBanner, which tracks usePathname for exactly this reason.
// Writes a data attribute rather than a class because React owns className on
// <html> and would clobber an imperatively added class on re-render.

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function PageSlug() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    const slug = pathname.split("/")[1] || "home";
    document.documentElement.setAttribute("data-page", slug);
  }, [pathname]);

  return null;
}

"use client";

// Keeps `data-page` on <html> in sync with the current route's first path
// segment ("/scores" -> "scores", "/" -> "home"), plus `data-banner-titled`,
// which marks a page whose header artwork already spells its name out.
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

import { bannerCarriesTitle, bannerSlugFor } from "@/lib/header-images";

export function PageSlug({ tenant }: { tenant: string | null }) {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    const el = document.documentElement;
    el.setAttribute("data-page", pathname.split("/")[1] || "home");
    if (bannerCarriesTitle(tenant, bannerSlugFor(pathname))) {
      el.setAttribute("data-banner-titled", "1");
    } else {
      el.removeAttribute("data-banner-titled");
    }
  }, [pathname, tenant]);

  return null;
}

// Global loading fallback. Renders during ANY route segment that
// doesn't ship its own loading.tsx (or while initial data fetches
// happen on a route that does). Per-route loading.tsx files override
// this for tighter, more on-brand placeholders.

import { Skeleton } from "@/components/ui/Skeleton";

export default function GlobalLoading() {
  return (
    <main className="container py-12">
      <Skeleton height={32} width="40%" style={{ marginBottom: 16 }} />
      <Skeleton height={16} width="60%" style={{ marginBottom: 8 }} />
      <Skeleton height={16} width="50%" style={{ marginBottom: 24 }} />
      <Skeleton height={120} width="100%" rounded={10} />
    </main>
  );
}

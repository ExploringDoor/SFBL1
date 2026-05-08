import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

export default function ScoresLoading() {
  return (
    <main className="container py-12">
      <Skeleton height={36} width={160} style={{ marginBottom: 8 }} />
      <Skeleton height={14} width={260} style={{ marginBottom: 24 }} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 12,
        }}
      >
        {Array.from({ length: 9 }, (_, i) => (
          <SkeletonCard key={i} height={120} />
        ))}
      </div>
    </main>
  );
}

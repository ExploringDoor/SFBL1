import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

export default function TeamsLoading() {
  return (
    <main className="container py-12">
      <Skeleton height={36} width={140} style={{ marginBottom: 24 }} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 16,
        }}
      >
        {Array.from({ length: 12 }, (_, i) => (
          <SkeletonCard key={i} height={160} />
        ))}
      </div>
    </main>
  );
}

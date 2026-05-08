import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

export default function PhotosLoading() {
  return (
    <main className="container py-12">
      <Skeleton height={36} width={140} style={{ marginBottom: 24 }} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 16,
        }}
      >
        {Array.from({ length: 8 }, (_, i) => (
          <SkeletonCard key={i} height={220} />
        ))}
      </div>
    </main>
  );
}

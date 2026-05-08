import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";

export default function ScheduleLoading() {
  return (
    <main className="container py-12">
      <Skeleton height={36} width={200} style={{ marginBottom: 8 }} />
      <Skeleton height={14} width={280} style={{ marginBottom: 24 }} />
      {/* Date heading + 3 cards per group, 3 groups */}
      {[0, 1, 2].map((g) => (
        <div key={g} style={{ marginBottom: 28 }}>
          <Skeleton
            height={22}
            width={180}
            style={{ marginBottom: 10 }}
          />
          <div style={{ display: "grid", gap: 10 }}>
            <SkeletonCard height={64} />
            <SkeletonCard height={64} />
            <SkeletonCard height={64} />
          </div>
        </div>
      ))}
    </main>
  );
}

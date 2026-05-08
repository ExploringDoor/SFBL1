import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";

export default function StandingsLoading() {
  return (
    <main className="container py-12">
      <Skeleton height={36} width={220} style={{ marginBottom: 8 }} />
      <Skeleton height={14} width={300} style={{ marginBottom: 24 }} />
      {/* Three division blocks. */}
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ marginBottom: 32 }}>
          <Skeleton
            height={20}
            width={140}
            style={{ marginBottom: 12 }}
          />
          <SkeletonTable rows={6} columns={9} />
        </div>
      ))}
    </main>
  );
}

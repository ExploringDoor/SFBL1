import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";

export default function TeamDetailLoading() {
  return (
    <main className="container py-12">
      {/* Hero — logo box + name + record */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          marginBottom: 28,
        }}
      >
        <Skeleton width={96} height={96} rounded={12} />
        <div style={{ flex: 1 }}>
          <Skeleton height={36} width="60%" style={{ marginBottom: 8 }} />
          <Skeleton height={14} width="40%" />
        </div>
      </div>
      {/* Two-column: roster + recent games */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.1fr 1fr",
          gap: 24,
        }}
      >
        <section>
          <Skeleton height={20} width={100} style={{ marginBottom: 12 }} />
          <SkeletonTable rows={12} columns={3} />
        </section>
        <section>
          <Skeleton height={20} width={140} style={{ marginBottom: 12 }} />
          <SkeletonTable rows={6} columns={4} />
        </section>
      </div>
    </main>
  );
}

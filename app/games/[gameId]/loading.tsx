import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";

export default function GameDetailLoading() {
  return (
    <main className="container py-12">
      {/* Final/score banner placeholder */}
      <Skeleton
        height={120}
        width="100%"
        rounded={12}
        style={{ marginBottom: 24 }}
      />
      {/* Linescore placeholder */}
      <Skeleton
        height={80}
        width="100%"
        rounded={8}
        style={{ marginBottom: 24 }}
      />
      {/* Two team boxes */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 24,
        }}
      >
        {[0, 1].map((i) => (
          <section key={i}>
            <Skeleton height={20} width={140} style={{ marginBottom: 10 }} />
            <SkeletonTable rows={9} columns={6} />
          </section>
        ))}
      </div>
    </main>
  );
}

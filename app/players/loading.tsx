import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";

export default function PlayersLoading() {
  return (
    <main className="container py-12">
      <Skeleton height={36} width={160} style={{ marginBottom: 8 }} />
      <Skeleton height={14} width={260} style={{ marginBottom: 20 }} />
      <SkeletonTable rows={20} columns={8} />
    </main>
  );
}

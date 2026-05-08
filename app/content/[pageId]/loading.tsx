import { Skeleton } from "@/components/ui/Skeleton";

export default function ContentLoading() {
  return (
    <main className="container py-12">
      <Skeleton height={40} width="60%" style={{ marginBottom: 16 }} />
      <Skeleton height={14} width="30%" style={{ marginBottom: 32 }} />
      {/* Body paragraphs */}
      {[100, 95, 80, 100, 70, 95, 90, 75].map((w, i) => (
        <Skeleton
          key={i}
          height={14}
          width={`${w}%`}
          style={{ marginBottom: 10 }}
        />
      ))}
    </main>
  );
}

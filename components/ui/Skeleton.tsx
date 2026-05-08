// Reusable skeleton primitives for loading states. Pulse animation
// matches Tailwind's `animate-pulse` but lives in plain CSS so we
// don't depend on any specific framework.

import "./Skeleton.css";

export function Skeleton({
  width,
  height,
  rounded = 6,
  style,
}: {
  width?: number | string;
  height?: number | string;
  rounded?: number;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className="le-skeleton"
      aria-hidden
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        borderRadius: rounded,
        ...style,
      }}
    />
  );
}

export function SkeletonRow({ columns = 6 }: { columns?: number }) {
  return (
    <div className="le-skeleton-row">
      {Array.from({ length: columns }, (_, i) => (
        <Skeleton key={i} height={14} width={`${100 / columns}%`} />
      ))}
    </div>
  );
}

export function SkeletonCard({ height = 80 }: { height?: number }) {
  return (
    <div className="le-skeleton-card">
      <Skeleton height={height} width="100%" rounded={10} />
    </div>
  );
}

export function SkeletonTable({
  rows = 5,
  columns = 6,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="le-skeleton-table">
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} columns={columns} />
      ))}
    </div>
  );
}

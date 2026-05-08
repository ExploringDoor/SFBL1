// Loading skeleton for /history. Mirrors the real page so the layout
// doesn't jump when the JSON read + Firestore team fetch finish.

export default function HistoryLoading() {
  return (
    <main className="container py-10">
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <Block w={80} h={14} />
        <div style={{ height: 8 }} />
        <Block w="60%" h={48} />
      </div>

      {/* Stats strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 10,
          margin: "20px 0 22px",
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              background: "rgba(0,0,0,0.04)",
              border: "1px solid rgba(0,0,0,0.06)",
              borderRadius: 12,
              height: 78,
            }}
          />
        ))}
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 18,
          padding: 4,
          background: "rgba(0,0,0,0.04)",
          borderRadius: 12,
        }}
      >
        {[140, 110, 130].map((w, i) => (
          <Block key={i} w={w} h={36} radius={8} />
        ))}
      </div>

      {/* Two-column placeholder for the default Champions tab */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.7fr 1fr",
          gap: 16,
        }}
      >
        <Block w="100%" h={420} radius={14} />
        <Block w="100%" h={420} radius={14} />
      </div>
    </main>
  );
}

function Block({
  w,
  h,
  radius = 6,
}: {
  w: number | string;
  h: number;
  radius?: number;
}) {
  return (
    <div
      style={{
        width: w,
        height: h,
        background: "rgba(0,0,0,0.06)",
        borderRadius: radius,
      }}
    />
  );
}

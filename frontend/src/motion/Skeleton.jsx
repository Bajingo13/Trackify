import { motion } from "motion/react";

/**
 * Shimmering skeletons — used instead of spinners while data loads.
 *
 *   <Skeleton w={180} h={14} />
 *   <SkeletonText lines={3} />
 *   <SkeletonRows cols={5} rows={6} />
 */

const base = {
  position: "relative",
  overflow: "hidden",
  background: "var(--surface-sunk)",
  borderRadius: "var(--r-sm)",
};

function Shimmer() {
  return (
    <motion.span
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        transform: "translateX(-100%)",
        background:
          "linear-gradient(90deg, transparent, color-mix(in srgb, var(--n-0) 55%, transparent), transparent)",
      }}
      animate={{ x: ["-100%", "100%"] }}
      transition={{ duration: 1.25, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.25 }}
    />
  );
}

export function Skeleton({ w = "100%", h = 12, r, style }) {
  return (
    <span
      style={{
        ...base,
        display: "block",
        width: typeof w === "number" ? `${w}px` : w,
        height: typeof h === "number" ? `${h}px` : h,
        borderRadius: r ?? "var(--r-sm)",
        ...style,
      }}
    >
      <Shimmer />
    </span>
  );
}

export function SkeletonText({ lines = 3, gap = 8 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} h={11} w={i === lines - 1 ? "62%" : "100%"} />
      ))}
    </div>
  );
}

export function SkeletonRows({ cols = 5, rows = 6 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          style={{
            display: "grid",
            gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)`,
            gap: 16,
            padding: "13px 16px",
            borderBottom: "1px solid var(--line-soft)",
          }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} h={11} w={c === 0 ? "70%" : `${45 + ((r + c) % 3) * 15}%`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ h = 92 }) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: "var(--r-md)",
        background: "var(--surface)",
        padding: "var(--s-4)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minHeight: h,
      }}
    >
      <Skeleton w={90} h={10} />
      <Skeleton w={64} h={22} />
    </div>
  );
}

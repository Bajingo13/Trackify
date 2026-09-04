import { motion } from "motion/react";
import { SkeletonRows } from "../../motion/Skeleton";
import { EmptyState } from "./index";

/**
 * Animated table: shimmering skeleton while loading, rows stagger in, hover lift.
 *
 *   <DataTable
 *     loading={loading}
 *     columns={[
 *       { key: "ticketNo", header: "Trip", render: (r) => <b>{r.ticketNo}</b> },
 *       { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
 *     ]}
 *     rows={trips}
 *     rowKey={(r) => r.id}
 *     onRowClick={openTrip}
 *     empty={{ icon: FileText, title: "No trips" }}
 *   />
 */
export default function DataTable({ columns, rows = [], loading, rowKey, onRowClick, empty, flashKey }) {
  const gridCols = columns.map((c) => c.width || (c.grow ? "2fr" : "1fr")).join(" ");

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r-lg)", background: "var(--surface)", boxShadow: "var(--shadow-2)", overflow: "hidden" }}>
      {/* header */}
      <div
        style={{
          display: "grid", gridTemplateColumns: gridCols, gap: 16, padding: "11px 16px",
          background: "var(--surface-sunk)", borderBottom: "1px solid var(--line)",
          fontSize: "var(--fs-11)", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-3)",
        }}
      >
        {columns.map((c) => (
          <div key={c.key} style={{ textAlign: c.align || "left", whiteSpace: "nowrap" }}>{c.header}</div>
        ))}
      </div>

      {loading ? (
        <SkeletonRows cols={columns.length} rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState {...(empty || { title: "Nothing here yet" })} />
      ) : (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.024, delayChildren: 0.03 } } }}
          style={{ overflowX: "auto" }}
        >
          {rows.map((r) => {
            const k = rowKey ? rowKey(r) : r.id;
            const isFlash = flashKey != null && String(k) === String(flashKey);
            return (
              <motion.div
                key={k}
                variants={{ hidden: { opacity: 0, y: 7 }, show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } } }}
                {...(isFlash ? { animate: { backgroundColor: ["rgba(36,85,214,0.16)", "rgba(36,85,214,0)"] }, transition: { duration: 1.2 } } : {})}
                whileHover={onRowClick ? { backgroundColor: "var(--accent-soft)" } : undefined}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                style={{
                  display: "grid", gridTemplateColumns: gridCols, gap: 16, padding: "12px 16px",
                  borderBottom: "1px solid var(--line-soft)", alignItems: "center",
                  fontSize: "var(--fs-13)", color: "var(--text-2)", cursor: onRowClick ? "pointer" : "default",
                }}
              >
                {columns.map((c) => (
                  <div key={c.key} style={{ textAlign: c.align || "left", minWidth: 0 }}>
                    {c.render ? c.render(r) : r[c.key] ?? "—"}
                  </div>
                ))}
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}

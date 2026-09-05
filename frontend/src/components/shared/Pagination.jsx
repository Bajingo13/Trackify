import { ChevronLeft, ChevronRight } from "lucide-react";

export default function Pagination({ page, totalPages, total, perPage, onPageChange }) {
  if (totalPages <= 1) return null;

  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);

  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push("...");
      const rangeStart = Math.max(2, page - 1);
      const rangeEnd = Math.min(totalPages - 1, page + 1);
      for (let i = rangeStart; i <= rangeEnd; i++) pages.push(i);
      if (page < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  };

  const btnBase = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 32,
    height: 32,
    padding: "0 6px",
    borderRadius: "var(--r-sm)",
    border: "1px solid var(--line)",
    background: "var(--surface)",
    color: "var(--text-2)",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    transition: "background var(--dur-1), border-color var(--dur-1), color var(--dur-1)",
    fontVariantNumeric: "tabular-nums",
    userSelect: "none",
  };

  const btnActive = {
    ...btnBase,
    background: "var(--accent-soft)",
    color: "var(--accent)",
    borderColor: "var(--accent-line)",
    fontWeight: 600,
  };

  const btnDisabled = {
    ...btnBase,
    opacity: 0.4,
    cursor: "not-allowed",
  };

  const btnEllipsis = {
    ...btnBase,
    border: "none",
    background: "transparent",
    cursor: "default",
    color: "var(--text-3)",
    minWidth: 24,
  };

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", borderTop: "1px solid var(--line-soft)" }}>
      <span style={{ fontSize: 12, color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
        Showing {start} to {end} of {total} entries
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          style={page === 1 ? btnDisabled : btnBase}
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={14} />
        </button>
        {getPageNumbers().map((p, i) =>
          p === "..." ? (
            <span key={`ellipsis-${i}`} style={btnEllipsis}>...</span>
          ) : (
            <button
              key={p}
              style={p === page ? btnActive : btnBase}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          )
        )}
        <button
          style={page === totalPages ? btnDisabled : btnBase}
          disabled={page === totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

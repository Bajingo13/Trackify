export function MiniStat({ label, value, tone }) {
  const color = tone === "warn" ? "var(--warn)" : tone === "ok" ? "var(--ok)" : tone === "danger" ? "var(--danger)" : "var(--text)";
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "12px 14px" }}>
      <div style={{ fontSize: "var(--fs-11)", textTransform: "uppercase", letterSpacing: ".04em", color: "var(--text-2)", fontWeight: 600 }}>{label}</div>
      <div className="tk-mono" style={{ fontSize: "var(--fs-18)", color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

export const statGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  gap: 12,
  marginBottom: 14,
};

export { formatDate as fmtDate } from "../../utils/date";

/** Simple prev/next pager. `pg` = { total, page, limit } | null. */
export function Pager({ pg, onPage }) {
  if (!pg || pg.total <= pg.limit) return null;
  const pages = Math.ceil(pg.total / pg.limit);
  const from = (pg.page - 1) * pg.limit + 1;
  const to = Math.min(pg.page * pg.limit, pg.total);
  const btn = {
    padding: "5px 10px", border: "1px solid var(--line-strong, var(--line))",
    borderRadius: "var(--r-sm)", background: "var(--surface)", fontSize: 12,
    color: "var(--text)", cursor: "pointer",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 2px", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
      <span>{from}–{to} of {pg.total}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <button style={{ ...btn, opacity: pg.page <= 1 ? 0.4 : 1 }} disabled={pg.page <= 1} onClick={() => onPage(pg.page - 1)}>Previous</button>
        <span style={{ padding: "5px 4px" }}>Page {pg.page} / {pages}</span>
        <button style={{ ...btn, opacity: pg.page >= pages ? 0.4 : 1 }} disabled={pg.page >= pages} onClick={() => onPage(pg.page + 1)}>Next</button>
      </div>
    </div>
  );
}

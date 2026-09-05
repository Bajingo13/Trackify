/**
 * Operational KPI card — used across Operations, Fleet and Warehouse.
 *
 * Deliberately monochrome: the figure carries the card. `color` and `bg` are
 * still accepted so no call site breaks, but they are not used for decoration —
 * colour is reserved for interaction state here, and for genuinely semantic
 * signals elsewhere (severity rails, status badges).
 *
 * Prop contract unchanged: icon, label, count, color, bg, active, onClick.
 */
export default function OpsStatCard({ icon: Icon, label, count, color, bg, active, onClick, hint }) {
  void color; void bg;
  const clickable = typeof onClick === "function";

  return (
    <button
      type="button"
      className={`ops-kpi-card ${active ? "ops-kpi-active" : ""}`}
      onClick={onClick}
      aria-pressed={clickable ? !!active : undefined}
      style={{ cursor: clickable ? "pointer" : "default" }}
    >
      {Icon && (
        <span className="ops-kpi-icon" aria-hidden="true">
          <Icon size={15} />
        </span>
      )}
      <div className="ops-kpi-content">
        <span className="ops-kpi-label">{label}</span>
        <span className="ops-kpi-count">{count}</span>
        {hint && <span className="ops-kpi-hint">{hint}</span>}
      </div>
    </button>
  );
}

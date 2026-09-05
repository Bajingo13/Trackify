/**
 * Operational KPI card — used across Operations, Fleet and Warehouse.
 *
 * The prop contract is unchanged (icon, label, count, color, bg, active,
 * onClick) so every existing call site keeps working; `hint` is optional.
 * Previously `icon` was accepted and silently dropped — it now renders.
 */
export default function OpsStatCard({ icon: Icon, label, count, color, bg, active, onClick, hint }) {
  const clickable = typeof onClick === "function";

  return (
    <button
      type="button"
      className={`ops-kpi-card ${active ? "ops-kpi-active" : ""}`}
      onClick={onClick}
      aria-pressed={clickable ? !!active : undefined}
      style={{ "--kpi-color": color, "--kpi-bg": bg, cursor: clickable ? "pointer" : "default" }}
    >
      {Icon && (
        <span className="ops-kpi-icon" aria-hidden="true">
          <Icon size={16} />
        </span>
      )}
      <div className="ops-kpi-content">
        <span className="ops-kpi-count">{count}</span>
        <span className="ops-kpi-label">{label}</span>
        {hint && <span className="ops-kpi-hint">{hint}</span>}
      </div>
    </button>
  );
}

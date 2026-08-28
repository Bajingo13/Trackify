export default function OpsStatCard({ icon: Icon, label, count, color, bg, active, onClick }) {
  return (
    <button
      className={`ops-kpi-card ${active ? "ops-kpi-active" : ""}`}
      onClick={onClick}
      style={{ "--kpi-color": color, "--kpi-bg": bg }}
    >
      <div className="ops-kpi-content">
        <span className="ops-kpi-count">{count}</span>
        <span className="ops-kpi-label">{label}</span>
      </div>
    </button>
  );
}

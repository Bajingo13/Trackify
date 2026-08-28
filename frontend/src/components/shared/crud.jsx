import { useEffect } from "react";
import { X } from "lucide-react";
import TopNav from "../dashboard/TopNav";
import "../../styles/operations.css";

/* Page shell — matches the operations pages (TopNav + ops-container). */
export function PageShell({ title, subtitle, actions, children }) {
  return (
    <div className="ops-page">
      <TopNav />
      <div className="ops-container">
        <div className="ops-header">
          <div className="ops-header-left">
            <h1 className="ops-title">{title}</h1>
            {subtitle && <p className="ops-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="ops-header-actions">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

/* Back-compat alias used by the admin pages. */
export { PageShell as AdminShell };

export function StatusPill({ status }) {
  const active = status === "active";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: active ? "#15803D" : "#B91C1C",
        background: active ? "#DCFCE7" : "#FEF2F2",
        border: `1px solid ${active ? "#BBF7D0" : "#FECACA"}`,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: active ? "#22C55E" : "#EF4444",
        }}
      />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export function Modal({ title, onClose, children, width = 480 }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(7,26,74,0.28)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "60px 20px",
        zIndex: 9000,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: width,
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 24px 60px rgba(7,26,74,0.24)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            borderBottom: "1px solid var(--trackify-border-soft)",
            background: "#FAFBFE",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--trackify-text)" }}>
            {title}
          </h3>
          <button
            onClick={onClose}
            className="ops-btn ops-btn-ghost"
            style={{ padding: 4 }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <div className="ops-form-group">
      <label className="ops-form-label">{label}</label>
      {children}
      {hint && (
        <span style={{ fontSize: 11, color: "var(--trackify-text-secondary)", marginTop: 3 }}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function TableCard({ children }) {
  return (
    <div className="ops-card">
      <div className="ops-table-wrapper">{children}</div>
    </div>
  );
}

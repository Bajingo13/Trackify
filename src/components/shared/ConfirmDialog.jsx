import { AlertTriangle } from "lucide-react";

export default function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", onConfirm, onCancel, danger = false }) {
  if (!open) return null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99998, animation: "fade-in 0.15s ease" }} onClick={onCancel}>
      <div
        style={{ background: "#fff", borderRadius: 16, padding: "24px", maxWidth: 400, width: "90%", boxShadow: "0 8px 32px rgba(0,0,0,0.15)", animation: "modal-in 0.2s ease" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: danger ? "#FEF2F2" : "#FFFBEB", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <AlertTriangle size={20} style={{ color: danger ? "#EF4444" : "#F59E0B" }} />
          </div>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--trackify-text)", margin: "0 0 4px" }}>{title}</h3>
            <p style={{ fontSize: 13, color: "var(--trackify-text-secondary)", margin: 0, lineHeight: 1.5 }}>{message}</p>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--trackify-border)", background: "#fff", fontSize: 13, fontWeight: 500, color: "var(--trackify-text)", cursor: "pointer" }}>
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 600, color: "#fff", cursor: "pointer",
              background: danger ? "linear-gradient(90deg, #DC2626, #B91C1C)" : "linear-gradient(90deg, #2455D6, #102F8A)",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

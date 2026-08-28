import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";

const ToastContext = createContext(null);

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS = {
  success: { bg: "#DCFCE7", border: "#BBF7D0", text: "#15803D", icon: "#22C55E" },
  error: { bg: "#FEF2F2", border: "#FECACA", text: "#B91C1C", icon: "#EF4444" },
  warning: { bg: "#FFFBEB", border: "#FDE68A", text: "#92400E", icon: "#F59E0B" },
  info: { bg: "#EEF4FF", border: "#B5C8F5", text: "#1E40AF", icon: "#2455D6" },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = "success", duration = 3000) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div style={{ position: "fixed", top: 20, right: 20, zIndex: 99999, display: "flex", flexDirection: "column", gap: 8, maxWidth: 380 }}>
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type] || Info;
          const color = COLORS[toast.type] || COLORS.info;
          return (
            <div
              key={toast.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 16px",
                background: color.bg,
                border: `1px solid ${color.border}`,
                borderRadius: 12,
                boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
                animation: "toast-in 0.25s ease",
              }}
            >
              <Icon size={18} style={{ color: color.icon, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: color.text }}>{toast.message}</span>
              <button onClick={() => removeToast(toast.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", color: color.text }}>
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";

const ToastContext = createContext(null);

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

// map toast type → design tokens (light + dark handled by tokens.css)
const TONE = {
  // A confirmation is the expected outcome, so it stays neutral: an inverted
  // chip that reads as the system speaking. Only a failure earns colour.
  success: { bg: "var(--text)", fg: "var(--surface)", icon: "var(--surface)" },
  info: { bg: "var(--text)", fg: "var(--surface)", icon: "var(--surface)" },
  warning: { bg: "var(--text)", fg: "var(--surface)", icon: "var(--warn)" },
  error: { bg: "var(--danger)", fg: "#fff", icon: "#fff" },
};

const MAX_VISIBLE = 4;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const h = timers.current.get(id);
    if (h) { clearTimeout(h); timers.current.delete(id); }
  }, []);

  const addToast = useCallback((message, type = "success", duration = 3500) => {
    let id;
    setToasts((prev) => {
      // collapse an identical message that's already on screen — bump its count
      const dupe = prev.find((t) => t.message === message && t.type === type);
      if (dupe) {
        id = dupe.id;
        return prev.map((t) => (t.id === dupe.id ? { ...t, count: (t.count || 1) + 1 } : t));
      }
      id = Date.now() + Math.random();
      const next = [...prev, { id, message, type, count: 1 }];
      return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
    });
    if (duration > 0) {
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      timers.current.set(id, setTimeout(() => removeToast(id), duration));
    }
    return id;
  }, [removeToast]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          top: "calc(16px + env(safe-area-inset-top, 0px))",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 99999,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          maxWidth: "min(420px, calc(100vw - 32px))",
          pointerEvents: "none",
        }}
      >
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type] || Info;
          const tone = TONE[toast.type] || TONE.info;
          return (
            <div
              key={toast.id}
              className="tk-toast"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "9px 12px 9px 13px",
                background: tone.bg,
                border: "1px solid transparent",
                borderRadius: "var(--r-pill, 999px)",
                boxShadow: "var(--shadow-3, 0 10px 30px rgba(12,26,56,.20))",
                color: tone.fg,
                fontFamily: "var(--font-sans, system-ui, sans-serif)",
                pointerEvents: "auto",
                maxWidth: "100%",
              }}
            >
              <Icon size={16} style={{ color: tone.icon, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13, lineHeight: 1.35, fontWeight: 500 }}>
                {toast.message}
                {toast.count > 1 && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      color: tone.bg,
                      background: tone.fg,
                      borderRadius: 999,
                      padding: "1px 6px",
                    }}
                  >
                    ×{toast.count}
                  </span>
                )}
              </span>
              <button
                onClick={() => removeToast(toast.id)}
                aria-label="Dismiss"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", color: tone.fg, opacity: 0.65, flexShrink: 0 }}
              >
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

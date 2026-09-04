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
  success: { fg: "var(--ok)", line: "var(--ok-line)", soft: "var(--ok-soft)" },
  error: { fg: "var(--danger)", line: "var(--danger-line)", soft: "var(--danger-soft)" },
  warning: { fg: "var(--warn)", line: "var(--warn-line)", soft: "var(--warn-soft)" },
  info: { fg: "var(--accent)", line: "var(--accent-line, var(--line))", soft: "var(--accent-soft)" },
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
          bottom: "calc(20px + env(safe-area-inset-bottom, 0px))",
          right: 20,
          zIndex: 99999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: "min(360px, calc(100vw - 40px))",
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
                alignItems: "flex-start",
                gap: 10,
                padding: "11px 12px 11px 13px",
                background: "var(--surface, #fff)",
                border: "1px solid var(--line, #e5e7eb)",
                borderLeft: `3px solid ${tone.fg}`,
                borderRadius: "var(--r-md, 11px)",
                boxShadow: "var(--shadow-2, 0 6px 16px rgba(12,26,56,.12))",
                color: "var(--text, #0c1a38)",
                fontFamily: "var(--font-sans, system-ui, sans-serif)",
                pointerEvents: "auto",
              }}
            >
              <Icon size={17} style={{ color: tone.fg, flexShrink: 0, marginTop: 1 }} />
              <span style={{ flex: 1, fontSize: 13, lineHeight: 1.4, fontWeight: 500 }}>
                {toast.message}
                {toast.count > 1 && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      color: tone.fg,
                      background: tone.soft,
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
                style={{ background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex", color: "var(--text-3, #9aa8c6)", flexShrink: 0 }}
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

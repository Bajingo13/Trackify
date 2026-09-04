import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { backdrop, scaleIn, drawerRight } from "../../motion";
import Button from "./Button";

function useEscClose(open, onClose) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
}

function Shell({ open, onClose, children, align, motionVariants, width }) {
  useEscClose(open, onClose);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="tk-scope"
          variants={backdrop}
          initial="hidden"
          animate="show"
          exit="exit"
          onMouseDown={onClose}
          style={{
            position: "fixed", inset: 0, background: "var(--overlay)", zIndex: 9000,
            display: "flex", alignItems: align === "right" ? "stretch" : "flex-start",
            justifyContent: align === "right" ? "flex-end" : "center",
            padding: align === "right" ? 0 : "72px 20px",
          }}
        >
          <motion.div
            variants={motionVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              boxShadow: "var(--shadow-3)",
              width: "100%",
              maxWidth: width,
              ...(align === "right"
                ? { height: "100%", borderRadius: 0, borderTop: 0, borderBottom: 0, borderRight: 0, display: "flex", flexDirection: "column" }
                : { borderRadius: "var(--r-lg)", maxHeight: "calc(100vh - 120px)", display: "flex", flexDirection: "column" }),
            }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function Head({ title, onClose }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 18px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", flexShrink: 0 }}>
      <h3 style={{ margin: 0, fontSize: "var(--fs-15)", fontWeight: 700, color: "var(--text)" }}>{title}</h3>
      <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Close" style={{ padding: 5 }} />
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, width = 460 }) {
  return (
    <Shell open={open} onClose={onClose} motionVariants={scaleIn} width={width}>
      <Head title={title} onClose={onClose} />
      <div style={{ padding: "var(--s-5)", overflowY: "auto" }}>{children}</div>
      {footer && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--s-2)", padding: "13px 18px", borderTop: "1px solid var(--line)", flexShrink: 0 }}>
          {footer}
        </div>
      )}
    </Shell>
  );
}

export function Drawer({ open, onClose, title, children, footer, width = 460 }) {
  return (
    <Shell open={open} onClose={onClose} align="right" motionVariants={drawerRight} width={width}>
      <Head title={title} onClose={onClose} />
      <div style={{ padding: "var(--s-5)", overflowY: "auto", flex: 1 }}>{children}</div>
      {footer && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--s-2)", padding: "13px 18px", borderTop: "1px solid var(--line)", flexShrink: 0 }}>
          {footer}
        </div>
      )}
    </Shell>
  );
}

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import AppShell from "../layout/AppShell";
import { PageHeader, Card, Field as UIField, StatusPill as UIStatusPill } from "../ui";
import { scaleIn, backdrop } from "../../motion";
import "../../styles/operations.css";

/**
 * Shared CRUD-page scaffolding used by the admin + master-data screens.
 * Rebuilt on the new shell so those pages inherit the redesign.
 */
export function PageShell({ title, subtitle, eyebrow, actions, children }) {
  return (
    <AppShell pageKey={title}>
      <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} actions={actions} />
      {children}
    </AppShell>
  );
}
export { PageShell as AdminShell };

export const StatusPill = UIStatusPill;
export const Field = UIField;

export function TableCard({ children, maxHeight = "min(68vh, 780px)" }) {
  return (
    <Card pad="0" style={{ overflow: "hidden" }}>
      {/* scroll container — gives the sticky .ops-table header something to
          stick to, so long admin/finance lists keep their column labels */}
      <div style={{ overflow: "auto", maxHeight }}>{children}</div>
    </Card>
  );
}

/**
 * Modal — kept compatible with the old call style: the page mounts it
 * conditionally (`{modal && <Modal title onClose>…</Modal>}`), no `open` prop.
 */
export function Modal({ title, onClose, children, width = 460 }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="tk-scope"
        variants={backdrop}
        initial="hidden"
        animate="show"
        exit="exit"
        onMouseDown={onClose}
        style={{
          position: "fixed", inset: 0, background: "var(--overlay)", zIndex: 9000,
          display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "72px 20px",
        }}
      >
        <motion.div
          variants={scaleIn}
          initial="hidden"
          animate="show"
          exit="exit"
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            width: "100%", maxWidth: width, background: "var(--surface)",
            border: "1px solid var(--line)", borderRadius: "var(--r-lg)",
            boxShadow: "var(--shadow-3)", overflow: "hidden", display: "flex", flexDirection: "column",
            maxHeight: "calc(100vh - 140px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 18px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", flexShrink: 0 }}>
            <h3 style={{ margin: 0, fontSize: "var(--fs-15)", fontWeight: 700, color: "var(--text)" }}>{title}</h3>
            <button onClick={onClose} aria-label="Close" style={{ display: "inline-flex", padding: 5, border: "none", background: "transparent", cursor: "pointer", color: "var(--text-2)", borderRadius: "var(--r-xs)" }}>
              <X size={16} />
            </button>
          </div>
          <div style={{ padding: "var(--s-5)", overflowY: "auto" }}>{children}</div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

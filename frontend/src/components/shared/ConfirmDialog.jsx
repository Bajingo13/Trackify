import { AlertTriangle } from "lucide-react";
import { Button, Modal } from "../ui";

/** Built on the shared Modal so confirmations look like every other form dialog. */
export default function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", onConfirm, onCancel, danger = false, softBackdrop = false }) {
  return (
    <Modal
      open={!!open}
      softBackdrop={softBackdrop}
      title={title}
      onClose={onCancel}
      width={420}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: danger ? "#FEF2F2" : "#FFFBEB", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <AlertTriangle size={20} style={{ color: danger ? "#EF4444" : "#F59E0B" }} />
        </div>
        <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}>{message}</p>
      </div>
    </Modal>
  );
}

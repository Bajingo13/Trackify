import { Modal } from "../shared/crud";
import { Button } from "../ui";

/**
 * Confirmation prompt for an action that needs a beat of thought — deactivating
 * a record, deleting, anything not trivially reversible.
 *
 *   <ConfirmDialog
 *     title="Deactivate company?"
 *     message="Users in this company lose access until it's reactivated."
 *     confirmLabel="Deactivate"
 *     tone="danger"
 *     loading={saving}
 *     onConfirm={doIt}
 *     onClose={() => setConfirm(null)}
 *   />
 */
export default function ConfirmDialog({
  title,
  message,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
  onConfirm,
  onClose,
}) {
  return (
    <Modal title={title} onClose={onClose} width={420}>
      {children ? (
        <div style={{ margin: "0 0 var(--s-5)" }}>{children}</div>
      ) : (
        <p style={{ margin: "0 0 var(--s-5)", fontSize: "var(--fs-13)", color: "var(--text-2)", lineHeight: 1.6 }}>
          {message}
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--s-2)" }}>
        <Button variant="ghost" onClick={onClose} disabled={loading}>{cancelLabel}</Button>
        <Button
          variant={tone === "danger" ? "danger-solid" : "primary"}
          loading={loading}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

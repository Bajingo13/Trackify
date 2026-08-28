import { useState, useEffect, useCallback } from "react";
import { Plus, Search, MapPin, Edit3, Power } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import {
  listBranches,
  createBranch,
  updateBranch,
} from "../../services/admin/branchService";
import { AdminShell, StatusPill, Modal, Field, TableCard } from "../../components/shared/crud";
import { Can } from "../../auth/permissions";

export default function BranchesPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listBranches({ search }));
    } catch (err) {
      addToast(err.message || "Failed to load branches", "error");
    } finally {
      setLoading(false);
    }
  }, [search, addToast]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function toggleStatus(row) {
    try {
      await updateBranch(row.branch_id, {
        status: row.status === "active" ? "inactive" : "active",
      });
      addToast("Branch updated", "success");
      load();
    } catch (err) {
      addToast(err.message || "Update failed", "error");
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    setSaving(true);
    try {
      if (modal.mode === "create") {
        await createBranch({
          branchName: form.get("branchName"),
          branchCode: form.get("branchCode"),
          prefix: form.get("prefix"),
        });
        addToast("Branch created", "success");
      } else {
        await updateBranch(modal.row.branch_id, {
          branchName: form.get("branchName"),
          prefix: form.get("prefix"),
        });
        addToast("Branch updated", "success");
      }
      setModal(null);
      load();
    } catch (err) {
      addToast(err.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell
      title="Branches"
      subtitle="Operating branches for the current company"
      actions={
        <Can permission="branch.manage">
          <button className="ops-btn ops-btn-primary" onClick={() => setModal({ mode: "create" })}>
            <Plus size={15} /> New Branch
          </button>
        </Can>
      }
    >
      <div className="ops-card" style={{ marginBottom: 14 }}>
        <div className="ops-filters">
          <div className="ops-search">
            <Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search branches..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <TableCard>
        <table className="ops-table">
          <thead>
            <tr>
              <th>Branch</th>
              <th>Code</th>
              <th>Prefix</th>
              <th>Company</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6}><div className="ops-empty"><div className="ops-empty-desc">Loading…</div></div></td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="ops-empty">
                    <div className="ops-empty-icon"><MapPin size={32} /></div>
                    <div className="ops-empty-title">No branches found</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.branch_id}>
                  <td style={{ fontWeight: 600, color: "var(--trackify-text)" }}>{row.branch_name}</td>
                  <td>{row.branch_code}</td>
                  <td>{row.prefix || "—"}</td>
                  <td>{row.company_name}</td>
                  <td><StatusPill status={row.status} /></td>
                  <td>
                    <Can permission="branch.manage" fallback={<span style={{ color: "var(--trackify-text-muted)", fontSize: 12 }}>—</span>}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} title="Edit" onClick={() => setModal({ mode: "edit", row })}>
                          <Edit3 size={13} />
                        </button>
                        <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} title={row.status === "active" ? "Deactivate" : "Activate"} onClick={() => toggleStatus(row)}>
                          <Power size={13} />
                        </button>
                      </div>
                    </Can>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableCard>

      {modal && (
        <Modal title={modal.mode === "create" ? "New Branch" : "Edit Branch"} onClose={() => setModal(null)}>
          <form onSubmit={handleSave}>
            <Field label="Branch Name *">
              <input className="ops-form-input" name="branchName" required defaultValue={modal.row?.branch_name || ""} placeholder="Davao Branch" />
            </Field>
            {modal.mode === "create" && (
              <Field label="Branch Code *" hint="Unique within the company, e.g. DVO">
                <input className="ops-form-input" name="branchCode" required placeholder="DVO" style={{ textTransform: "uppercase" }} />
              </Field>
            )}
            <Field label="Ticket Prefix" hint="Used for trip ticket numbers. Defaults to the branch code.">
              <input className="ops-form-input" name="prefix" defaultValue={modal.row?.prefix || ""} placeholder="DVO" style={{ textTransform: "uppercase" }} />
            </Field>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button type="button" className="ops-back-btn" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="ops-btn ops-btn-primary" disabled={saving} style={{ borderRadius: 10 }}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </AdminShell>
  );
}

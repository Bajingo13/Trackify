import { useState, useEffect, useCallback } from "react";
import { Plus, Search, Building2, Edit3, Power } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import {
  listCompanies,
  createCompany,
  updateCompany,
} from "../../services/admin/companyService";
import { AdminShell, StatusPill, Modal, Field, TableCard } from "../../components/shared/crud";
import { Can } from "../../auth/permissions";

export default function CompaniesPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null); // null | {mode:'create'} | {mode:'edit', row}
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listCompanies({ search }));
    } catch (err) {
      addToast(err.message || "Failed to load companies", "error");
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
      await updateCompany(row.company_id, {
        status: row.status === "active" ? "inactive" : "active",
      });
      addToast("Company updated", "success");
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
        await createCompany({
          companyName: form.get("companyName"),
          companyCode: form.get("companyCode"),
        });
        addToast("Company created", "success");
      } else {
        await updateCompany(modal.row.company_id, {
          companyName: form.get("companyName"),
        });
        addToast("Company updated", "success");
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
      title="Companies"
      subtitle="Manage the companies operating on Trackify"
      actions={
        <Can permission="company.manage">
          <button className="ops-btn ops-btn-primary" onClick={() => setModal({ mode: "create" })}>
            <Plus size={15} /> New Company
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
              placeholder="Search companies..."
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
              <th>Company</th>
              <th>Code</th>
              <th>Branches</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5}><div className="ops-empty"><div className="ops-empty-desc">Loading…</div></div></td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="ops-empty">
                    <div className="ops-empty-icon"><Building2 size={32} /></div>
                    <div className="ops-empty-title">No companies found</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.company_id}>
                  <td style={{ fontWeight: 600, color: "var(--trackify-text)" }}>{row.company_name}</td>
                  <td>{row.company_code}</td>
                  <td>{row.branch_count}</td>
                  <td><StatusPill status={row.status} /></td>
                  <td>
                    <Can permission="company.manage" fallback={<span style={{ color: "var(--trackify-text-muted)", fontSize: 12 }}>—</span>}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          className="ops-btn ops-btn-ghost"
                          style={{ padding: "4px 8px" }}
                          title="Edit"
                          onClick={() => setModal({ mode: "edit", row })}
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          className="ops-btn ops-btn-ghost"
                          style={{ padding: "4px 8px" }}
                          title={row.status === "active" ? "Deactivate" : "Activate"}
                          onClick={() => toggleStatus(row)}
                        >
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
        <Modal
          title={modal.mode === "create" ? "New Company" : "Edit Company"}
          onClose={() => setModal(null)}
        >
          <form onSubmit={handleSave}>
            <Field label="Company Name *">
              <input
                className="ops-form-input"
                name="companyName"
                required
                defaultValue={modal.row?.company_name || ""}
                placeholder="AstreaBlue Logistics"
              />
            </Field>
            {modal.mode === "create" && (
              <Field label="Company Code *" hint="Short unique code, e.g. ABL">
                <input
                  className="ops-form-input"
                  name="companyCode"
                  required
                  placeholder="ABL"
                  style={{ textTransform: "uppercase" }}
                />
              </Field>
            )}
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

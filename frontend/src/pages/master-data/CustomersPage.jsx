import { useState, useEffect, useCallback } from "react";
import { Plus, Search, Contact, Edit3, Power } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import { PageShell, StatusPill, Modal, Field, TableCard } from "../../components/shared/crud";
import { Can } from "../../auth/permissions";
import {
  listCustomers,
  createCustomer,
  updateCustomer,
} from "../../services/master-data/customerService";

export default function CustomersPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null); // {mode:'create'} | {mode:'edit', row}
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await listCustomers({ search, limit: 200 });
      setRows(data);
    } catch (err) {
      addToast(err.message || "Failed to load customers", "error");
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
      await updateCustomer(row.customer_id, {
        status: row.status === "active" ? "inactive" : "active",
      });
      addToast("Customer updated", "success");
      load();
    } catch (err) {
      addToast(err.message || "Update failed", "error");
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      customerName: form.get("customerName"),
      contactPerson: form.get("contactPerson"),
      phone: form.get("phone"),
      email: form.get("email"),
      address: form.get("address"),
    };
    setSaving(true);
    try {
      if (modal.mode === "create") {
        await createCustomer(payload);
        addToast("Customer created", "success");
      } else {
        await updateCustomer(modal.row.customer_id, payload);
        addToast("Customer updated", "success");
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
    <PageShell
      title="Customers"
      subtitle="Master list of customers for the current company"
      actions={
        <Can permission="customer.manage">
          <button className="ops-btn ops-btn-primary" onClick={() => setModal({ mode: "create" })}>
            <Plus size={15} /> New Customer
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
              placeholder="Search customers..."
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
              <th>Code</th>
              <th>Customer</th>
              <th>Contact</th>
              <th>Phone</th>
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
                    <div className="ops-empty-icon"><Contact size={32} /></div>
                    <div className="ops-empty-title">No customers found</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.customer_id}>
                  <td>{row.customer_code}</td>
                  <td style={{ fontWeight: 600, color: "var(--trackify-text)" }}>{row.customer_name}</td>
                  <td>{row.contact_person || "—"}</td>
                  <td>{row.phone || "—"}</td>
                  <td><StatusPill status={row.status} /></td>
                  <td>
                    <Can permission="customer.manage" fallback={<span style={{ color: "var(--trackify-text-muted)", fontSize: 12 }}>—</span>}>
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
        <Modal title={modal.mode === "create" ? "New Customer" : "Edit Customer"} onClose={() => setModal(null)} width={520}>
          <form onSubmit={handleSave}>
            <Field label="Customer Name *">
              <input className="ops-form-input" name="customerName" required defaultValue={modal.row?.customer_name || ""} />
            </Field>
            <div className="ops-form-row">
              <Field label="Contact Person">
                <input className="ops-form-input" name="contactPerson" defaultValue={modal.row?.contact_person || ""} />
              </Field>
              <Field label="Phone">
                <input className="ops-form-input" name="phone" defaultValue={modal.row?.phone || ""} />
              </Field>
            </div>
            <Field label="Email">
              <input className="ops-form-input" type="email" name="email" defaultValue={modal.row?.email || ""} />
            </Field>
            <Field label="Address">
              <textarea className="ops-form-input ops-form-textarea" name="address" defaultValue={modal.row?.address || ""} />
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
    </PageShell>
  );
}

import { useState, useEffect, useCallback } from "react";
import { Plus, Building2, Edit3, Power } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import {
  listCompanies,
  createCompany,
  updateCompany,
} from "../../services/admin/companyService";
import { Modal, Field } from "../../components/shared/crud";
import { Button } from "../../components/ui";
import {
  SettingsPage,
  SettingsToolbar,
  SearchInput,
  SettingsTable,
  StatusBadge,
  ConfirmDialog,
} from "../../components/settings";
import { Can } from "../../auth/permissions";

export default function CompaniesPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null); // null | {mode:'create'} | {mode:'edit', row}
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // null | { row }
  const [confirmBusy, setConfirmBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listCompanies({ search }));
    } catch (err) {
      setError(err.message || "Failed to load companies");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function doToggle(row) {
    setConfirmBusy(true);
    try {
      await updateCompany(row.company_id, {
        status: row.status === "active" ? "inactive" : "active",
      });
      addToast(row.status === "active" ? "Company deactivated" : "Company activated", "success");
      setConfirm(null);
      load();
    } catch (err) {
      addToast(err.message || "Update failed", "error");
    } finally {
      setConfirmBusy(false);
    }
  }

  function toggleStatus(row) {
    if (row.status === "active") setConfirm({ row });
    else doToggle(row);
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
    <SettingsPage
      eyebrow="Organization"
      title="Companies"
      description="The companies operating on Trackify."
      actions={
        <Can permission="company.manage">
          <Button variant="primary" icon={Plus} onClick={() => setModal({ mode: "create" })}>
            New Company
          </Button>
        </Can>
      }
    >
      <SettingsToolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search companies…" />
      </SettingsToolbar>

      <SettingsTable
        columns={[
          { key: "name", label: "Company" },
          { key: "code", label: "Code" },
          { key: "branches", label: "Branches" },
          { key: "status", label: "Status" },
          { key: "actions", label: "Actions", align: "right" },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={load}
        empty={{ icon: Building2, title: "No companies found" }}
        renderRow={(row) => (
          <tr key={row.company_id}>
            <td style={{ fontWeight: 600, color: "var(--text)" }}>{row.company_name}</td>
            <td>{row.company_code}</td>
            <td>{row.branch_count}</td>
            <td><StatusBadge status={row.status} /></td>
            <td style={{ textAlign: "right" }}>
              <Can permission="company.manage" fallback={<span style={{ color: "var(--text-3)", fontSize: 12 }}>—</span>}>
                <div style={{ display: "inline-flex", gap: 4 }}>
                  <Button variant="ghost" size="sm" icon={Edit3} title="Edit" aria-label="Edit" onClick={() => setModal({ mode: "edit", row })} />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Power}
                    title={row.status === "active" ? "Deactivate" : "Activate"}
                    aria-label={row.status === "active" ? "Deactivate" : "Activate"}
                    onClick={() => toggleStatus(row)}
                  />
                </div>
              </Can>
            </td>
          </tr>
        )}
      />

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
              <Button type="button" variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={saving}>Save</Button>
            </div>
          </form>
        </Modal>
      )}

      {confirm && (
        <ConfirmDialog
          title="Deactivate company?"
          message={`"${confirm.row.company_name}" will be marked inactive. Users in this company lose access until it's reactivated.`}
          confirmLabel="Deactivate"
          tone="danger"
          loading={confirmBusy}
          onConfirm={() => doToggle(confirm.row)}
          onClose={() => setConfirm(null)}
        />
      )}
    </SettingsPage>
  );
}

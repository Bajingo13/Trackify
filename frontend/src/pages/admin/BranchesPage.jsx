import { useState, useEffect, useCallback } from "react";
import { Plus, MapPin, Edit3, Power } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import {
  listBranches,
  createBranch,
  updateBranch,
} from "../../services/admin/branchService";
import { listCompanies } from "../../services/admin/companyService";
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
import { useAuth } from "../../context/AuthContext";

export default function BranchesPage() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [companies, setCompanies] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listBranches({ search }));
    } catch (err) {
      setError(err.message || "Failed to load branches");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (modal) {
      listCompanies({ status: "active" })
        .then(setCompanies)
        .catch(() => setCompanies([]));
    }
  }, [modal]);

  async function doToggle(row) {
    setConfirmBusy(true);
    try {
      await updateBranch(row.branch_id, {
        status: row.status === "active" ? "inactive" : "active",
      });
      addToast(row.status === "active" ? "Branch deactivated" : "Branch activated", "success");
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
        await createBranch({
          companyId: form.get("companyId"),
          branchName: form.get("branchName"),
          branchCode: form.get("branchCode"),
          prefix: form.get("prefix"),
        });
        addToast("Branch created", "success");
      } else {
        await updateBranch(modal.row.branch_id, {
          companyId: form.get("companyId"),
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
    <SettingsPage
      eyebrow="Organization"
      title="Branches"
      description="Operating branches for the current company."
      actions={
        <Can permission="branch.manage">
          <Button variant="primary" icon={Plus} onClick={() => setModal({ mode: "create" })}>
            New Branch
          </Button>
        </Can>
      }
    >
      <SettingsToolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search branches…" />
      </SettingsToolbar>

      <SettingsTable
        columns={[
          { key: "name", label: "Branch" },
          { key: "code", label: "Code" },
          { key: "prefix", label: "Prefix" },
          { key: "company", label: "Company" },
          { key: "status", label: "Status" },
          { key: "actions", label: "Actions", align: "right" },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={load}
        empty={{ icon: MapPin, title: "No branches found" }}
        renderRow={(row) => (
          <tr key={row.branch_id}>
            <td style={{ fontWeight: 600, color: "var(--text)" }}>{row.branch_name}</td>
            <td>{row.branch_code}</td>
            <td>{row.prefix || "—"}</td>
            <td>{row.company_name}</td>
            <td><StatusBadge status={row.status} /></td>
            <td style={{ textAlign: "right" }}>
              <Can permission="branch.manage" fallback={<span style={{ color: "var(--text-3)", fontSize: 12 }}>—</span>}>
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
        <Modal title={modal.mode === "create" ? "New Branch" : "Edit Branch"} onClose={() => setModal(null)}>
          <form onSubmit={handleSave}>
            <Field label="Company *">
              <select
                className="ops-form-input"
                name="companyId"
                required
                defaultValue={modal.row?.company_id || user?.company_id || ""}
                disabled={!user?.isSystemAdmin}
              >
                <option value="">Select a company</option>
                {companies.map((c) => (
                  <option key={c.company_id} value={c.company_id}>
                    {c.company_name}
                  </option>
                ))}
              </select>
            </Field>
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
              <Button type="button" variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={saving}>Save</Button>
            </div>
          </form>
        </Modal>
      )}

      {confirm && (
        <ConfirmDialog
          title="Deactivate branch?"
          message={`"${confirm.row.branch_name}" will be marked inactive and can't be used for new trip tickets until reactivated.`}
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

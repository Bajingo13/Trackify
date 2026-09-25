import { useState, useEffect, useCallback } from "react";
import { Plus, Building2, Edit3, Power } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../components/shared/Toast";
import {
  listCompanies,
  createCompany,
  updateCompany,
  suspendCompany,
  reactivateCompany,
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
import { Can, usePermissions } from "../../auth/permissions";

export default function CompaniesPage() {
  const navigate = useNavigate();
  const { isSystemAdmin } = usePermissions();
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null); // null | {mode:'create'} | {mode:'edit', row}
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null); // null | { mode, row }
  const [suspensionReason, setSuspensionReason] = useState("");
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

  async function changeAccess() {
    const { mode, row } = confirm;
    setConfirmBusy(true);
    try {
      if (mode === "suspend") await suspendCompany(row.company_id, suspensionReason);
      else await reactivateCompany(row.company_id);
      addToast(mode === "suspend" ? "Company suspended" : "Company reactivated", "success");
      setConfirm(null);
      setSuspensionReason("");
      load();
    } catch (err) {
      addToast(err.message || "Update failed", "error");
    } finally {
      setConfirmBusy(false);
    }
  }

  function toggleStatus(row) {
    setSuspensionReason("");
    setConfirm({ mode: row.status === "active" ? "suspend" : "reactivate", row });
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
      actions={isSystemAdmin ? (
        <Button variant="primary" icon={Plus} onClick={() => navigate("/admin/settings/client-setup")}>
          New Client Setup
        </Button>
      ) : null}
    >
      <SettingsToolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search companies…" />
      </SettingsToolbar>

      <SettingsTable
        columns={[
          { key: "name", label: "Company" },
          { key: "code", label: "Code" },
          { key: "branches", label: "Branches" },
          { key: "setup", label: "Setup Health" },
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
            <td>
              {Number(row.active_branch_count) > 0 && Number(row.admin_count) > 0 ? (
                <div>
                  <span style={{ color: "#047857", fontWeight: 600, fontSize: 12 }}>Ready</span>
                  <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 2 }}>
                    {row.active_branch_count} active {Number(row.active_branch_count) === 1 ? "branch" : "branches"} · {row.admin_count} {Number(row.admin_count) === 1 ? "administrator" : "administrators"}
                  </div>
                </div>
              ) : (
                <div>
                  <span style={{ color: "#b91c1c", fontWeight: 600, fontSize: 12 }}>
                    Needs {Number(row.active_branch_count) === 0 && Number(row.admin_count) === 0
                      ? "branch and administrator"
                      : Number(row.active_branch_count) === 0 ? "branch" : "administrator"}
                  </span>
                  <div style={{ color: "var(--text-3)", fontSize: 11, marginTop: 2 }}>
                    {row.active_branch_count} active {Number(row.active_branch_count) === 1 ? "branch" : "branches"} · {row.admin_count} {Number(row.admin_count) === 1 ? "administrator" : "administrators"}
                  </div>
                </div>
              )}
            </td>
            <td>
              <StatusBadge status={row.status} />
              {row.status === "inactive" && row.suspension_reason && (
                <div title={row.suspension_reason} style={{ color: "var(--text-3)", fontSize: 11, marginTop: 4, maxWidth: 220 }}>
                  {row.suspension_reason}
                </div>
              )}
            </td>
            <td style={{ textAlign: "right" }}>
              <Can permission="company.manage" fallback={<span style={{ color: "var(--text-3)", fontSize: 12 }}>—</span>}>
                <div style={{ display: "inline-flex", gap: 4 }}>
                  <Button variant="ghost" size="sm" icon={Edit3} title="Edit" aria-label="Edit" onClick={() => setModal({ mode: "edit", row })} />
                  {isSystemAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Power}
                      title={row.status === "active" ? "Suspend" : "Reactivate"}
                      aria-label={row.status === "active" ? "Suspend" : "Reactivate"}
                      onClick={() => toggleStatus(row)}
                    />
                  )}
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

      {confirm?.mode === "reactivate" && (
        <ConfirmDialog
          title="Reactivate company?"
          message={`Users at "${confirm.row.company_name}" will regain access to active branches after reactivation.`}
          confirmLabel="Reactivate"
          loading={confirmBusy}
          onConfirm={changeAccess}
          onClose={() => setConfirm(null)}
        />
      )}

      {confirm?.mode === "suspend" && (
        <Modal title="Suspend company?" onClose={() => !confirmBusy && setConfirm(null)}>
          <p style={{ margin: "0 0 16px", color: "var(--text-2)", fontSize: 13, lineHeight: 1.55 }}>
            Users at <strong>{confirm.row.company_name}</strong> will immediately lose access. The reason is recorded for administrators and in the audit log.
          </p>
          <Field label="Suspension reason *" hint="10–500 characters">
            <textarea
              className="ops-form-input"
              rows={4}
              maxLength={500}
              value={suspensionReason}
              onChange={(event) => setSuspensionReason(event.target.value)}
              placeholder="Explain why access is being suspended"
            />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <Button variant="ghost" disabled={confirmBusy} onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={confirmBusy}
              disabled={suspensionReason.trim().length < 10}
              onClick={changeAccess}
            >
              Suspend company
            </Button>
          </div>
        </Modal>
      )}
    </SettingsPage>
  );
}

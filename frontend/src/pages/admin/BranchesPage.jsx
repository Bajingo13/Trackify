import { useState, useEffect, useCallback, useMemo } from "react";
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
  FilterButton,
  SettingsTable,
  StatusBadge,
  ConfirmDialog,
} from "../../components/settings";
import { Can } from "../../auth/permissions";
import { useAuth } from "../../context/AuthContext";

export default function BranchesPage() {
  const { addToast } = useToast();
  const { user, isSystemAdmin } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState("");        // modal: the branch's company
  const [companyFilter, setCompanyFilter] = useState(""); // list: "" = current company
  const [moveConfirm, setMoveConfirm] = useState(null);   // pending cross-company move payload

  // The company the user is currently operating in — the default for a new
  // branch, and the only choice for anyone who isn't a System Administrator.
  const activeCompanyId = useMemo(() => {
    try {
      return localStorage.getItem("ttms_company_id") || user?.access?.[0]?.company_id || "";
    } catch {
      return user?.access?.[0]?.company_id || "";
    }
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listBranches({ search, companyId: companyFilter || undefined }));
    } catch (err) {
      setError(err.message || "Failed to load branches");
    } finally {
      setLoading(false);
    }
  }, [search, companyFilter]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // System Admins can view and reassign branches across companies, so they need
  // the company picklist up front (for the list filter and the modal).
  useEffect(() => {
    if (!isSystemAdmin && !modal) return;
    listCompanies({ status: "active" })
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, [isSystemAdmin, modal]);

  // Seed the modal's company selector each time it opens.
  useEffect(() => {
    if (modal) setCompanyId(String(modal.row?.company_id ?? activeCompanyId ?? ""));
  }, [modal, activeCompanyId]);

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

  const companyName = (id) =>
    companies.find((c) => String(c.company_id) === String(id))?.company_name;

  function handleSave(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      companyId,
      branchName: form.get("branchName"),
      prefix: form.get("prefix"),
      ...(modal.mode === "create" ? { branchCode: form.get("branchCode") } : {}),
    };
    // Moving an existing branch to another company makes it drop out of this
    // list — confirm before doing it silently.
    const isMove =
      modal.mode === "edit" &&
      isSystemAdmin &&
      String(companyId) !== String(modal.row.company_id);
    if (isMove) {
      setMoveConfirm(payload);
      return;
    }
    persist(payload);
  }

  async function persist(payload) {
    setSaving(true);
    try {
      if (modal.mode === "create") {
        await createBranch(payload);
        addToast("Branch created", "success");
      } else {
        const moved = String(payload.companyId) !== String(modal.row.company_id);
        await updateBranch(modal.row.branch_id, payload);
        addToast(
          moved
            ? `Branch moved to ${companyName(payload.companyId) || "the selected company"}`
            : "Branch updated",
          "success"
        );
      }
      setModal(null);
      setMoveConfirm(null);
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
        {isSystemAdmin && (
          <FilterButton
            label="Company"
            value={companyFilter}
            options={[
              { value: "", label: "Current company" },
              ...companies.map((c) => ({ value: String(c.company_id), label: c.company_name })),
            ]}
            onChange={setCompanyFilter}
          />
        )}
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
            <Field
              label="Company *"
              hint={
                isSystemAdmin
                  ? (modal.mode === "edit" ? "Move this branch to a different company." : undefined)
                  : "Locked to the company you're operating in."
              }
            >
              <select
                className="ops-form-input"
                name="companyId"
                required
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                disabled={!isSystemAdmin}
              >
                <option value="" disabled>Select a company</option>
                {/* keep the current value selectable even before the list loads */}
                {companyId &&
                  !companies.some((c) => String(c.company_id) === companyId) && (
                    <option value={companyId}>
                      {modal.row?.company_name || "Current company"}
                    </option>
                  )}
                {companies.map((c) => (
                  <option key={c.company_id} value={String(c.company_id)}>
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

      {moveConfirm && modal?.row && (
        <ConfirmDialog
          title="Move branch to another company?"
          message={`"${modal.row.branch_name}" will move to ${companyName(moveConfirm.companyId) || "the selected company"}. It will leave this list — to see it again, filter by that company or switch your operating company.`}
          confirmLabel="Move branch"
          cancelLabel="Cancel"
          tone="primary"
          loading={saving}
          onConfirm={() => persist(moveConfirm)}
          onClose={() => setMoveConfirm(null)}
        />
      )}
    </SettingsPage>
  );
}

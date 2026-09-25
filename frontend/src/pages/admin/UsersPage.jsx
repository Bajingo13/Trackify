import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Users as UsersIcon, Edit3, Power, Shield, Eye, FileDown, ChevronLeft, ChevronRight, KeyRound, Clipboard } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  setUserRoles,
  issueTemporaryPassword,
} from "../../services/admin/userService";
import { listRoles } from "../../services/admin/roleService";
import { listBranches } from "../../services/admin/branchService";
import { usePermissions, Can } from "../../auth/permissions";
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
import { exportLockedWorkbook } from "../../utils/exportExcel";
import UserDetailDrawer from "./UserDetailDrawer";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

function accessStatus(row) {
  if (!row.must_change_password) return { label: "Activated", color: "#047857" };
  const expired = !row.temporary_password_expires_at || new Date(row.temporary_password_expires_at).getTime() <= Date.now();
  return expired
    ? { label: "Temporary expired", color: "#b91c1c" }
    : { label: "Temporary", color: "#b45309" };
}

export default function UsersPage() {
  const { can } = usePermissions();
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [roles, setRoles] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [roleFilter, setRoleFilter] = useState("");
  const [modal, setModal] = useState(null); // {mode:'create'} | {mode:'edit', user} | {mode:'roles', user, roleIds}
  const [detailUser, setDetailUser] = useState(null); // row whose detail drawer is open
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [dirty, setDirty] = useState(false);          // the open modal's form has edits
  const [saveConfirm, setSaveConfirm] = useState(null); // { kind, title, payload, summary[] }
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [temporaryConfirm, setTemporaryConfirm] = useState(null);
  const [temporaryAccess, setTemporaryAccess] = useState(null);

  const ROLE_OPTIONS = useMemo(
    () => [
      { value: "", label: "All roles" },
      ...roles.map((r) => ({ value: String(r.role_id), label: r.role_name })),
    ],
    [roles]
  );

  // reset the change-tracking whenever a modal opens or closes
  useEffect(() => {
    setDirty(false);
    setSaveConfirm(null);
    setDiscardConfirm(false);
  }, [modal]);

  // filters changed — go back to page 1
  useEffect(() => { setPage(1); }, [search, status, roleFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, pagination: p } = await listUsers({
        search, status, roleId: roleFilter, page, limit: 25,
      });
      setRows(data);
      if (p) setPagination(p);
    } catch (err) {
      setError(err.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [search, status, roleFilter, page]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    // the role picker needs role.read; a branch manager has user.read without
    // it, so asking anyway just produced a 403 on every visit
    if (!can("role.read")) { setRoles([]); return; }
    listRoles().then(setRoles).catch(() => setRoles([]));
  }, [can]);

  useEffect(() => {
    if (!can("branch.read")) { setBranches([]); return; }
    listBranches({ status: "active" }).then(setBranches).catch(() => setBranches([]));
  }, [can]);

  async function doToggle(row) {
    setConfirmBusy(true);
    try {
      await updateUser(row.user_id, {
        status: row.status === "active" ? "inactive" : "active",
      });
      addToast(row.status === "active" ? "User deactivated" : "User activated", "success");
      setConfirm(null);
      load();
    } catch (err) {
      addToast(err.message || "Update failed", "error");
    } finally {
      setConfirmBusy(false);
    }
  }

  function toggleStatus(row) {
    setConfirm({ row });
  }

  async function openRoles(row) {
    try {
      const detail = await getUser(row.user_id);
      setModal({
        mode: "roles",
        user: row,
        roleIds: (detail.roles || []).map((r) => r.role_id),
      });
    } catch (err) {
      addToast(err.message || "Failed to load user", "error");
    }
  }

  function requestClose() {
    if (saving) return;
    if (dirty) setDiscardConfirm(true);
    else setModal(null);
  }

  // New User saves straight away — there's nothing "changed" to review.
  async function doCreate(form) {
    setSaving(true);
    try {
      await createUser({
        firstName: form.get("firstName"),
        lastName: form.get("lastName"),
        email: form.get("email"),
        password: form.get("password"),
        roleId: form.get("roleId") || null,
        branchId: form.get("branchId") || null,
      });
      addToast("User created", "success");
      setModal(null);
      load();
    } catch (err) {
      addToast(err.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  // Edit / Roles: build a diff and ask for confirmation before writing anything.
  function handleSubmit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);

    if (modal.mode === "create") {
      doCreate(form);
      return;
    }

    if (modal.mode === "edit") {
      const nf = (form.get("firstName") || "").trim();
      const nl = (form.get("lastName") || "").trim();
      const of_ = modal.user.first_name || "";
      const ol = modal.user.last_name || "";
      const pw = form.get("password") || "";
      const newEmail = (form.get("email") || "").trim().toLowerCase();
      const oldEmail = (modal.user.email || "").toLowerCase();
      const emailChanged = newEmail && newEmail !== oldEmail;
      const oldName = `${of_} ${ol}`.trim();
      const newName = `${nf} ${nl}`.trim();
      const summary = [];
      if (newName !== oldName) summary.push(`Name: "${oldName}" → "${newName}"`);
      if (emailChanged) summary.push(`Email: "${modal.user.email}" → "${newEmail}"`);
      if (pw) summary.push("Password will be reset.");
      if (!summary.length) {
        addToast("No changes to save.", "info");
        return;
      }
      const payload = {
        firstName: nf, lastName: nl,
        ...(pw ? { password: pw } : {}),
        ...(emailChanged ? { email: newEmail } : {}),
      };
      setSaveConfirm({ kind: "edit", title: "Save changes to this user?", payload, summary });
      return;
    }

    if (modal.mode === "roles") {
      const nextIds = form.getAll("roleIds").map(Number);
      const prev = new Set(modal.roleIds);
      const next = new Set(nextIds);
      const nameOf = (rid) => roles.find((r) => r.role_id === rid)?.role_name || `#${rid}`;
      const added = nextIds.filter((rid) => !prev.has(rid)).map(nameOf);
      const removed = modal.roleIds.filter((rid) => !next.has(rid)).map(nameOf);
      const summary = [];
      if (added.length) summary.push(`Add: ${added.join(", ")}`);
      if (removed.length) summary.push(`Remove: ${removed.join(", ")}`);
      if (!summary.length) {
        addToast("No changes to save.", "info");
        return;
      }
      setSaveConfirm({ kind: "roles", title: "Update this user's roles?", payload: { roleIds: nextIds }, summary });
    }
  }

  async function persistSave() {
    if (!saveConfirm) return;
    setSaving(true);
    try {
      if (saveConfirm.kind === "edit") {
        await updateUser(modal.user.user_id, saveConfirm.payload);
        addToast("User updated", "success");
      } else {
        await setUserRoles(modal.user.user_id, saveConfirm.payload.roleIds);
        addToast("Roles updated", "success");
      }
      setSaveConfirm(null);
      setModal(null);
      load();
    } catch (err) {
      setSaveConfirm(null); // back to the still-open form; typed values are kept
      addToast(err.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const { data } = await listUsers({ search, status, roleId: roleFilter, page: 1, limit: 500 });
      await exportLockedWorkbook({
        filename: `Users ${new Date().toISOString().slice(0, 10)}`,
        title: "AstreaBlue Trackify — Users",
        meta: [
          ["Exported", new Date().toLocaleString()],
          ["Filters", `status: ${status}, role: ${ROLE_OPTIONS.find((r) => r.value === roleFilter)?.label || "All roles"}${search ? `, search: "${search}"` : ""}`],
        ],
        sheets: [{
          name: "Users",
          rows: [
            ["Name", "Email", "Roles", "Status", "Created"],
            ...data.map((u) => [
              `${u.first_name} ${u.last_name}`, u.email, u.roles || "—",
              u.status, new Date(u.created_at).toLocaleDateString(),
            ]),
          ],
        }],
      });
    } catch (err) {
      addToast(err.message || "Export failed", "error");
    } finally {
      setExporting(false);
    }
  }

  async function generateTemporaryAccess() {
    if (!temporaryConfirm) return;
    setConfirmBusy(true);
    try {
      const access = await issueTemporaryPassword(temporaryConfirm.user_id);
      setTemporaryConfirm(null);
      setTemporaryAccess(access);
      addToast("New temporary access issued", "success");
      load();
    } catch (err) {
      addToast(err.message || "Could not issue temporary access", "error");
    } finally {
      setConfirmBusy(false);
    }
  }

  async function copyTemporaryPassword() {
    await navigator.clipboard.writeText(temporaryAccess.temporaryPassword);
    addToast("Temporary password copied", "success");
  }

  return (
    <SettingsPage
      eyebrow="User Management"
      title="Users"
      description="People with access to the current company, and the roles they hold."
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Can permission="user.read">
            <Button variant="secondary" icon={FileDown} loading={exporting} onClick={handleExport}>
              Export to Excel
            </Button>
          </Can>
          <Can permission="user.manage">
            <Button variant="primary" icon={Plus} onClick={() => setModal({ mode: "create" })}>
              New User
            </Button>
          </Can>
        </div>
      }
    >
      <SettingsToolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search users…" />
        <FilterButton label="Status" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
        {roles.length > 0 && (
          <FilterButton label="Role" value={roleFilter} options={ROLE_OPTIONS} onChange={setRoleFilter} />
        )}
      </SettingsToolbar>

      <SettingsTable
        columns={[
          { key: "name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "roles", label: "Roles" },
          { key: "access", label: "Access" },
          { key: "status", label: "Status" },
          { key: "actions", label: "Actions", align: "right" },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={load}
        empty={{
          icon: UsersIcon,
          title: "No users found",
          hint: status !== "all" || roleFilter || search ? "Try clearing the filters." : undefined,
        }}
        renderRow={(row) => (
          <tr key={row.user_id}>
            <td style={{ fontWeight: 600, color: "var(--text)" }}>
              {row.first_name} {row.last_name}
            </td>
            <td>{row.email}</td>
            <td>{row.roles || "—"}</td>
            <td style={{ color: accessStatus(row).color, fontWeight: 600, fontSize: 12 }}>
              {accessStatus(row).label}
            </td>
            <td><StatusBadge status={row.status} /></td>
            <td style={{ textAlign: "right" }}>
              <div style={{ display: "inline-flex", gap: 4 }}>
                <Button variant="ghost" size="sm" icon={Eye} title="View" aria-label="View" onClick={() => setDetailUser(row)} />
                <Can permission="user.manage">
                  <Button variant="ghost" size="sm" icon={Edit3} title="Edit" aria-label="Edit" onClick={() => setModal({ mode: "edit", user: row })} />
                  <Button variant="ghost" size="sm" icon={Shield} title="Manage roles" aria-label="Manage roles" onClick={() => openRoles(row)} />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={KeyRound}
                    title="Issue temporary access"
                    aria-label="Issue temporary access"
                    disabled={row.status !== "active"}
                    onClick={() => setTemporaryConfirm(row)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Power}
                    title={row.status === "active" ? "Deactivate" : "Activate"}
                    aria-label={row.status === "active" ? "Deactivate" : "Activate"}
                    onClick={() => toggleStatus(row)}
                  />
                </Can>
              </div>
            </td>
          </tr>
        )}
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "var(--s-3)" }}>
        <span style={{ fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
          {pagination.total} {pagination.total === 1 ? "user" : "users"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button
            variant="ghost" size="sm" icon={ChevronLeft} aria-label="Previous page"
            disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
          />
          <span style={{ fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
            Page {pagination.page} of {pagination.totalPages || 1}
          </span>
          <Button
            variant="ghost" size="sm" icon={ChevronRight} aria-label="Next page"
            disabled={page >= (pagination.totalPages || 1)} onClick={() => setPage((p) => p + 1)}
          />
        </div>
      </div>

      {modal && (modal.mode === "create" || modal.mode === "edit") && (
        <Modal title={modal.mode === "create" ? "New User" : "Edit User"} onClose={requestClose}>
          <form onSubmit={handleSubmit} onChange={() => setDirty(true)}>
            <div className="ops-form-row">
              <Field label="First Name *">
                <input className="ops-form-input" name="firstName" required defaultValue={modal.user?.first_name || ""} />
              </Field>
              <Field label="Last Name *">
                <input className="ops-form-input" name="lastName" required defaultValue={modal.user?.last_name || ""} />
              </Field>
            </div>
            <Field label="Email *">
              <input
                className="ops-form-input" type="email" name="email" required
                defaultValue={modal.user?.email || ""} placeholder="name@company.com"
              />
            </Field>
            {modal.mode === "create" && (
              <div className="ops-form-row">
                <Field label="Role">
                  <select className="ops-form-input" name="roleId" defaultValue="">
                    <option value="">— No role —</option>
                    {roles.map((r) => (
                      <option key={r.role_id} value={r.role_id}>{r.role_name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Branch" hint="Leave blank for company-wide access.">
                  <select className="ops-form-input" name="branchId" defaultValue="">
                    <option value="">Company-wide (all branches)</option>
                    {branches.map((b) => (
                      <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
            <Field
              label={modal.mode === "create" ? "Password *" : "New Password"}
              hint="At least 10 characters. The user must replace it within 72 hours."
            >
              <input
                className="ops-form-input"
                type="password"
                name="password"
                required={modal.mode === "create"}
                minLength={10}
                placeholder={modal.mode === "edit" ? "Leave blank to keep current" : ""}
              />
            </Field>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <Button type="button" variant="ghost" onClick={requestClose}>Cancel</Button>
              <Button type="submit" variant="primary" loading={saving} disabled={modal.mode === "edit" && !dirty}>Save</Button>
            </div>
          </form>
        </Modal>
      )}

      {modal && modal.mode === "roles" && (
        <Modal title={`Roles — ${modal.user.first_name} ${modal.user.last_name}`} onClose={requestClose}>
          <form onSubmit={handleSubmit} onChange={() => setDirty(true)}>
            {roles.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--text-2)" }}>No roles defined yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                {roles.map((r) => (
                  <label key={r.role_id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      name="roleIds"
                      value={r.role_id}
                      defaultChecked={modal.roleIds.includes(r.role_id)}
                    />
                    {r.role_name}
                  </label>
                ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button type="button" variant="ghost" onClick={requestClose}>Cancel</Button>
              <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>Save Roles</Button>
            </div>
          </form>
        </Modal>
      )}

      {saveConfirm && (
        <ConfirmDialog
          title={saveConfirm.title}
          confirmLabel={saving ? "Saving…" : "Confirm & Save"}
          cancelLabel="Cancel"
          tone="primary"
          loading={saving}
          onConfirm={persistSave}
          onClose={() => { if (!saving) setSaveConfirm(null); }}
        >
          <p style={{ margin: "0 0 8px", fontSize: "var(--fs-13)", color: "var(--text-2)" }}>You changed:</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: "var(--fs-13)", color: "var(--text)" }}>
            {saveConfirm.summary.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
          <p style={{ margin: "10px 0 0", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
            This takes effect immediately for the user.
          </p>
        </ConfirmDialog>
      )}

      {discardConfirm && (
        <ConfirmDialog
          title="Discard changes?"
          message="You have unsaved changes. Are you sure you want to discard them? Your changes will not be saved."
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          tone="danger"
          onConfirm={() => { setDiscardConfirm(false); setDirty(false); setModal(null); }}
          onClose={() => setDiscardConfirm(false)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.row.status === "active" ? "Deactivate user?" : "Activate user?"}
          message={
            confirm.row.status === "active"
              ? `${confirm.row.first_name} ${confirm.row.last_name} will lose access immediately. You can reactivate them later.`
              : `${confirm.row.first_name} ${confirm.row.last_name} will regain access to the company.`
          }
          confirmLabel={confirm.row.status === "active" ? "Deactivate" : "Activate"}
          tone={confirm.row.status === "active" ? "danger" : "primary"}
          loading={confirmBusy}
          onConfirm={() => doToggle(confirm.row)}
          onClose={() => setConfirm(null)}
        />
      )}

      {temporaryConfirm && (
        <ConfirmDialog
          title="Issue new temporary access?"
          message={`This immediately replaces ${temporaryConfirm.first_name} ${temporaryConfirm.last_name}'s current password. Their existing session is blocked on its next request, and the new password expires after 72 hours.`}
          confirmLabel="Generate password"
          tone="primary"
          loading={confirmBusy}
          onConfirm={generateTemporaryAccess}
          onClose={() => setTemporaryConfirm(null)}
        />
      )}

      {temporaryAccess && (
        <Modal title="Temporary access created" onClose={() => setTemporaryAccess(null)}>
          <p style={{ marginTop: 0, color: "var(--text-2)" }}>
            Give this password securely to <strong>{temporaryAccess.email}</strong>. It is shown only here and must be replaced on first login.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <code style={{ padding: "10px 12px", borderRadius: 8, background: "var(--surface-sunk)", fontSize: 16 }}>
              {temporaryAccess.temporaryPassword}
            </code>
            <Button variant="secondary" icon={Clipboard} onClick={copyTemporaryPassword}>Copy password</Button>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-3)" }}>
            Expires {new Date(temporaryAccess.expiresAt).toLocaleString()}.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
            <Button variant="primary" onClick={() => setTemporaryAccess(null)}>I stored it safely</Button>
          </div>
        </Modal>
      )}

      {detailUser && (
        <UserDetailDrawer
          userId={detailUser.user_id}
          onClose={() => setDetailUser(null)}
        />
      )}
    </SettingsPage>
  );
}

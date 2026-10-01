import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Users as UsersIcon, Edit3, Power, Shield, Eye, FileDown, ChevronLeft, ChevronRight, KeyRound, Trash2, Send, UserX } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  setUserRoles,
  issueTemporaryPassword,
  resendInvitation,
  deleteUser,
} from "../../services/admin/userService";
import { listRoles } from "../../services/admin/roleService";
import { listBranches } from "../../services/admin/branchService";
import { usePermissions, Can } from "../../auth/permissions";
import { Modal, Field } from "../../components/shared/crud";
import { Button, Select } from "../../components/ui";
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
import TemporaryAccessDialog from "./TemporaryAccessDialog";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "inactive", label: "Inactive" },
];

function accessStatus(row) {
  if (row.status === "invited") return { label: "Awaiting setup", color: "#1d4ed8" };
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
  const [resendConfirm, setResendConfirm] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

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
      const turningOff = row.status === "active";
      await updateUser(row.user_id, { status: turningOff ? "inactive" : "active" });
      addToast(turningOff ? "User deactivated" : "User activated", "success");
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

  // Permanent. The server refuses accounts with history (they stay deactivated)
  // and says why, which is shown as-is.
  async function doDelete() {
    if (!deleteConfirm) return;
    const row = deleteConfirm;
    setConfirmBusy(true);
    try {
      await deleteUser(row.user_id);
      addToast(row.status === "invited" ? "Invitation cancelled" : "User deleted", "success");
      setDeleteConfirm(null);
      load();
    } catch (err) {
      setDeleteConfirm(null);
      addToast(err.message || "Could not delete this user", "error");
    } finally {
      setConfirmBusy(false);
    }
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
      const firstName = (form.get("firstName") || "").trim();
      const lastName = (form.get("lastName") || "").trim();
      const res = await createUser({
        firstName,
        lastName,
        email: form.get("email"),
        roleId: form.get("roleId") || null,
        branchId: form.get("branchId") || null,
      });
      setModal(null);
      setDirty(false);
      setTemporaryAccess({ ...res.data, name: `${firstName} ${lastName}`.trim(), kind: "invite" });
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
      const name = [temporaryConfirm.first_name, temporaryConfirm.last_name].filter(Boolean).join(" ");
      setTemporaryConfirm(null);
      setTemporaryAccess({ ...access, name });
      addToast("New temporary access issued", "success");
      load();
    } catch (err) {
      addToast(err.message || "Could not issue temporary access", "error");
    } finally {
      setConfirmBusy(false);
    }
  }

  async function copyHandover() {
    const invite = temporaryAccess.kind === "invite";
    await navigator.clipboard.writeText(invite ? temporaryAccess.inviteUrl : temporaryAccess.temporaryPassword);
    addToast(invite ? "Invitation link copied" : "Temporary password copied", "success");
  }

  async function doResendInvitation() {
    if (!resendConfirm) return;
    setConfirmBusy(true);
    try {
      const access = await resendInvitation(resendConfirm.user_id);
      const name = [resendConfirm.first_name, resendConfirm.last_name].filter(Boolean).join(" ");
      setResendConfirm(null);
      setTemporaryAccess({ ...access, name, kind: "invite" });
      load();
    } catch (err) {
      addToast(err.message || "Could not resend the invitation", "error");
    } finally {
      setConfirmBusy(false);
    }
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
              Invite User
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
                  {row.status === "invited" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Send}
                      title="Resend invitation"
                      aria-label={`Resend invitation to ${row.first_name} ${row.last_name}`}
                      onClick={() => setResendConfirm(row)}
                    />
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={KeyRound}
                      title="Issue temporary access"
                      aria-label="Issue temporary access"
                      disabled={row.status !== "active"}
                      onClick={() => setTemporaryConfirm(row)}
                    />
                  )}
                  {row.status === "active" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={UserX}
                      title="Deactivate user"
                      aria-label={`Deactivate ${row.first_name} ${row.last_name}`}
                      style={{ color: "var(--danger)" }}
                      onClick={() => toggleStatus(row)}
                    />
                  )}
                  {row.status === "inactive" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Power}
                      title="Activate user"
                      aria-label={`Activate ${row.first_name} ${row.last_name}`}
                      onClick={() => toggleStatus(row)}
                    />
                  )}
                  {row.status !== "active" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      title={row.status === "invited" ? "Cancel invitation" : "Delete permanently"}
                      aria-label={
                        row.status === "invited"
                          ? `Cancel invitation for ${row.first_name} ${row.last_name}`
                          : `Delete ${row.first_name} ${row.last_name} permanently`
                      }
                      style={{ color: "var(--danger)" }}
                      onClick={() => setDeleteConfirm(row)}
                    />
                  )}
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
        <Modal softBackdrop title={modal.mode === "create" ? "Invite User" : "Edit User"} onClose={requestClose}>
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
                  <Select name="roleId" defaultValue=""
                    options={[{ value: "", label: "— No role —" }, ...roles.map((r) => ({ value: r.role_id, label: r.role_name }))]} />
                </Field>
                <Field label="Branch" hint="Leave blank for company-wide access.">
                  <Select name="branchId" defaultValue=""
                    options={[{ value: "", label: "Company-wide (all branches)" }, ...branches.map((b) => ({ value: b.branch_id, label: b.branch_name }))]} />
                </Field>
              </div>
            )}
            {modal.mode === "create" ? (
              // No password here: the person chooses their own from the invitation.
              <div
                style={{
                  display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 13px", marginTop: 4,
                  borderRadius: "var(--r-md)", background: "var(--info-soft)", color: "var(--text-2)",
                  fontSize: 12.5, lineHeight: 1.5,
                }}
              >
                <Send size={15} style={{ flexShrink: 0, marginTop: 2, color: "var(--info)" }} aria-hidden="true" />
                <span>
                  We’ll email them an invitation to finish their account and choose their own password — you
                  won’t see it. The link expires in 3 days.
                </span>
              </div>
            ) : modal.user?.status !== "invited" && (
              <Field
                label="New Password"
                hint="10+ characters with an uppercase letter, a lowercase letter, a number and a special character. The user must replace it within 72 hours."
              >
                <input
                  className="ops-form-input"
                  type="password"
                  name="password"
                  minLength={10}
                  placeholder="Leave blank to keep current"
                />
              </Field>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <Button type="button" variant="ghost" onClick={requestClose}>Cancel</Button>
              {modal.mode === "create" ? (
                <Button type="submit" variant="primary" icon={Send} loading={saving}>Send invitation</Button>
              ) : (
                <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>Save</Button>
              )}
            </div>
          </form>
        </Modal>
      )}

      {modal && modal.mode === "roles" && (
        <Modal softBackdrop title={`Roles — ${modal.user.first_name} ${modal.user.last_name}`} onClose={requestClose}>
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

      {deleteConfirm && (
        <ConfirmDialog
          title={deleteConfirm.status === "invited" ? "Cancel invitation?" : "Delete user permanently?"}
          message={
            deleteConfirm.status === "invited"
              ? `The invitation sent to ${deleteConfirm.email} stops working and the unused account is removed. You can invite them again later.`
              : `${deleteConfirm.first_name} ${deleteConfirm.last_name} (${deleteConfirm.email}) will be removed for good. This can't be undone. Accounts with trips or other records are kept and stay deactivated instead.`
          }
          confirmLabel={deleteConfirm.status === "invited" ? "Cancel invitation" : "Delete permanently"}
          tone="danger"
          loading={confirmBusy}
          onConfirm={doDelete}
          onClose={() => setDeleteConfirm(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.row.status === "active" ? "Deactivate user?" : "Activate user?"}
          message={
            confirm.row.status === "active"
              ? `${confirm.row.first_name} ${confirm.row.last_name} will lose access immediately. Their historical activity is preserved, and you can reactivate them later.`
              : `${confirm.row.first_name} ${confirm.row.last_name} will regain access to the company.`
          }
          confirmLabel={confirm.row.status === "active" ? "Deactivate" : "Activate"}
          tone={confirm.row.status === "active" ? "danger" : "primary"}
          loading={confirmBusy}
          onConfirm={() => doToggle(confirm.row)}
          onClose={() => setConfirm(null)}
        />
      )}

      {resendConfirm && (
        <ConfirmDialog
          title="Resend invitation?"
          message={`${resendConfirm.first_name} ${resendConfirm.last_name} gets a new invitation at ${resendConfirm.email}, valid for 3 days. The previous link stops working.`}
          confirmLabel="Resend invitation"
          tone="primary"
          loading={confirmBusy}
          onConfirm={doResendInvitation}
          onClose={() => setResendConfirm(null)}
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
        <TemporaryAccessDialog
          access={temporaryAccess}
          kind={temporaryAccess.kind}
          onClose={() => setTemporaryAccess(null)}
          onCopy={copyHandover}
        />
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

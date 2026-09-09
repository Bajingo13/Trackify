import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Users as UsersIcon, Edit3, Power, Shield } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  setUserRoles,
} from "../../services/admin/userService";
import { listRoles } from "../../services/admin/roleService";
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

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export default function UsersPage() {
  const { can } = usePermissions();
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [modal, setModal] = useState(null); // {mode:'create'} | {mode:'edit', user} | {mode:'roles', user, roleIds}
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listUsers({ search }));
    } catch (err) {
      setError(err.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [search]);

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

  const visibleRows = useMemo(
    () => (status === "all" ? rows : rows.filter((r) => r.status === status)),
    [rows, status]
  );

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
    if (row.status === "active") setConfirm({ row });
    else doToggle(row);
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

  async function handleSave(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    setSaving(true);
    try {
      if (modal.mode === "create") {
        await createUser({
          firstName: form.get("firstName"),
          lastName: form.get("lastName"),
          email: form.get("email"),
          password: form.get("password"),
          roleId: form.get("roleId") || null,
        });
        addToast("User created", "success");
      } else if (modal.mode === "edit") {
        const payload = {
          firstName: form.get("firstName"),
          lastName: form.get("lastName"),
        };
        if (form.get("password")) payload.password = form.get("password");
        await updateUser(modal.user.user_id, payload);
        addToast("User updated", "success");
      } else if (modal.mode === "roles") {
        const roleIds = form.getAll("roleIds").map(Number);
        await setUserRoles(modal.user.user_id, roleIds);
        addToast("Roles updated", "success");
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
      eyebrow="User Management"
      title="Users"
      description="People with access to the current company, and the roles they hold."
      actions={
        <Can permission="user.manage">
          <Button variant="primary" icon={Plus} onClick={() => setModal({ mode: "create" })}>
            New User
          </Button>
        </Can>
      }
    >
      <SettingsToolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search users…" />
        <FilterButton label="Status" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
      </SettingsToolbar>

      <SettingsTable
        columns={[
          { key: "name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "roles", label: "Roles" },
          { key: "status", label: "Status" },
          { key: "actions", label: "Actions", align: "right" },
        ]}
        rows={visibleRows}
        loading={loading}
        error={error}
        onRetry={load}
        empty={{
          icon: UsersIcon,
          title: "No users found",
          hint: status !== "all" ? "Try clearing the status filter." : undefined,
        }}
        renderRow={(row) => (
          <tr key={row.user_id}>
            <td style={{ fontWeight: 600, color: "var(--text)" }}>
              {row.first_name} {row.last_name}
            </td>
            <td>{row.email}</td>
            <td>{row.roles || "—"}</td>
            <td><StatusBadge status={row.status} /></td>
            <td style={{ textAlign: "right" }}>
              <Can permission="user.manage" fallback={<span style={{ color: "var(--text-3)", fontSize: 12 }}>—</span>}>
                <div style={{ display: "inline-flex", gap: 4 }}>
                  <Button variant="ghost" size="sm" icon={Edit3} title="Edit" aria-label="Edit" onClick={() => setModal({ mode: "edit", user: row })} />
                  <Button variant="ghost" size="sm" icon={Shield} title="Manage roles" aria-label="Manage roles" onClick={() => openRoles(row)} />
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

      {modal && (modal.mode === "create" || modal.mode === "edit") && (
        <Modal title={modal.mode === "create" ? "New User" : "Edit User"} onClose={() => setModal(null)}>
          <form onSubmit={handleSave}>
            <div className="ops-form-row">
              <Field label="First Name *">
                <input className="ops-form-input" name="firstName" required defaultValue={modal.user?.first_name || ""} />
              </Field>
              <Field label="Last Name *">
                <input className="ops-form-input" name="lastName" required defaultValue={modal.user?.last_name || ""} />
              </Field>
            </div>
            {modal.mode === "create" && (
              <>
                <Field label="Email *">
                  <input className="ops-form-input" type="email" name="email" required placeholder="name@company.com" />
                </Field>
                <Field label="Role">
                  <select className="ops-form-input" name="roleId" defaultValue="">
                    <option value="">— No role —</option>
                    {roles.map((r) => (
                      <option key={r.role_id} value={r.role_id}>{r.role_name}</option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            <Field
              label={modal.mode === "create" ? "Password *" : "New Password"}
              hint="At least 8 characters."
            >
              <input
                className="ops-form-input"
                type="password"
                name="password"
                required={modal.mode === "create"}
                minLength={8}
                placeholder={modal.mode === "edit" ? "Leave blank to keep current" : ""}
              />
            </Field>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <Button type="button" variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={saving}>Save</Button>
            </div>
          </form>
        </Modal>
      )}

      {modal && modal.mode === "roles" && (
        <Modal title={`Roles — ${modal.user.first_name} ${modal.user.last_name}`} onClose={() => setModal(null)}>
          <form onSubmit={handleSave}>
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
              <Button type="button" variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={saving}>Save Roles</Button>
            </div>
          </form>
        </Modal>
      )}

      {confirm && (
        <ConfirmDialog
          title="Deactivate user?"
          message={`${confirm.row.first_name} ${confirm.row.last_name} will lose access immediately. You can reactivate them later.`}
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

import { useState, useEffect, useCallback } from "react";
import { Plus, Search, Users as UsersIcon, Edit3, Power, Shield } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  setUserRoles,
} from "../../services/admin/userService";
import { listRoles } from "../../services/admin/roleService";
import { AdminShell, StatusPill, Modal, Field, TableCard } from "../../components/shared/crud";
import { Can } from "../../auth/permissions";

export default function UsersPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null); // {mode:'create'} | {mode:'edit', user} | {mode:'roles', user, roleIds}
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listUsers({ search }));
    } catch (err) {
      addToast(err.message || "Failed to load users", "error");
    } finally {
      setLoading(false);
    }
  }, [search, addToast]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    listRoles().then(setRoles).catch(() => setRoles([]));
  }, []);

  async function toggleStatus(row) {
    try {
      await updateUser(row.user_id, {
        status: row.status === "active" ? "inactive" : "active",
      });
      addToast("User updated", "success");
      load();
    } catch (err) {
      addToast(err.message || "Update failed", "error");
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
    <AdminShell
      title="Users"
      subtitle="People with access to the current company"
      actions={
        <Can permission="user.manage">
          <button className="ops-btn ops-btn-primary" onClick={() => setModal({ mode: "create" })}>
            <Plus size={15} /> New User
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
              placeholder="Search users..."
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
              <th>Name</th>
              <th>Email</th>
              <th>Roles</th>
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
                    <div className="ops-empty-icon"><UsersIcon size={32} /></div>
                    <div className="ops-empty-title">No users found</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.user_id}>
                  <td style={{ fontWeight: 600, color: "var(--trackify-text)" }}>
                    {row.first_name} {row.last_name}
                  </td>
                  <td>{row.email}</td>
                  <td>{row.roles || "—"}</td>
                  <td><StatusPill status={row.status} /></td>
                  <td>
                    <Can permission="user.manage" fallback={<span style={{ color: "var(--trackify-text-muted)", fontSize: 12 }}>—</span>}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} title="Edit" onClick={() => setModal({ mode: "edit", user: row })}>
                          <Edit3 size={13} />
                        </button>
                        <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} title="Manage roles" onClick={() => openRoles(row)}>
                          <Shield size={13} />
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
              <button type="button" className="ops-back-btn" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="ops-btn ops-btn-primary" disabled={saving} style={{ borderRadius: 10 }}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal && modal.mode === "roles" && (
        <Modal title={`Roles — ${modal.user.first_name} ${modal.user.last_name}`} onClose={() => setModal(null)}>
          <form onSubmit={handleSave}>
            {roles.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--trackify-text-secondary)" }}>No roles defined yet.</p>
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
              <button type="button" className="ops-back-btn" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="ops-btn ops-btn-primary" disabled={saving} style={{ borderRadius: 10 }}>
                {saving ? "Saving…" : "Save Roles"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </AdminShell>
  );
}

import { useState, useEffect, useCallback } from "react";
import { Plus, ShieldCheck, Edit3, Power, KeyRound } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import {
  listRoles,
  getRole,
  listPermissions,
  createRole,
  updateRole,
  setRolePermissions,
} from "../../services/admin/roleService";
import { AdminShell, StatusPill, Modal, Field, TableCard } from "../../components/shared/crud";
import { Can } from "../../auth/permissions";

function groupPermissions(perms) {
  const groups = {};
  for (const p of perms) {
    const key = p.permission_code.split(".")[0];
    (groups[key] ||= []).push(p);
  }
  return groups;
}

export default function RolesPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // {mode:'create'} | {mode:'rename', role} | {mode:'perms', role, selected:Set}
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listRoles());
    } catch (err) {
      addToast(err.message || "Failed to load roles", "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    listPermissions().then(setPermissions).catch(() => setPermissions([]));
  }, []);

  async function toggleStatus(role) {
    try {
      await updateRole(role.role_id, {
        status: role.status === "active" ? "inactive" : "active",
      });
      addToast("Role updated", "success");
      load();
    } catch (err) {
      addToast(err.message || "Update failed", "error");
    }
  }

  async function openPerms(role) {
    try {
      const detail = await getRole(role.role_id);
      setModal({
        mode: "perms",
        role,
        selected: new Set((detail.permissions || []).map((p) => p.permission_id)),
      });
    } catch (err) {
      addToast(err.message || "Failed to load role", "error");
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    setSaving(true);
    try {
      if (modal.mode === "create") {
        await createRole({
          roleName: form.get("roleName"),
          permissionIds: form.getAll("permissionIds").map(Number),
        });
        addToast("Role created", "success");
      } else if (modal.mode === "rename") {
        await updateRole(modal.role.role_id, { roleName: form.get("roleName") });
        addToast("Role updated", "success");
      } else if (modal.mode === "perms") {
        await setRolePermissions(
          modal.role.role_id,
          form.getAll("permissionIds").map(Number)
        );
        addToast("Permissions updated", "success");
      }
      setModal(null);
      load();
    } catch (err) {
      addToast(err.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  const groups = groupPermissions(permissions);

  return (
    <AdminShell
      title="Roles & Permissions"
      subtitle="Define what each role can do within the current company"
      actions={
        <Can permission="role.manage">
          <button className="ops-btn ops-btn-primary" onClick={() => setModal({ mode: "create" })}>
            <Plus size={15} /> New Role
          </button>
        </Can>
      }
    >
      <TableCard>
        <table className="ops-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Permissions</th>
              <th>Users</th>
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
                    <div className="ops-empty-icon"><ShieldCheck size={32} /></div>
                    <div className="ops-empty-title">No roles defined</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((role) => (
                <tr key={role.role_id}>
                  <td style={{ fontWeight: 600, color: "var(--trackify-text)" }}>{role.role_name}</td>
                  <td>{role.permission_count}</td>
                  <td>{role.user_count}</td>
                  <td><StatusPill status={role.status} /></td>
                  <td>
                    <Can permission="role.manage" fallback={<span style={{ color: "var(--trackify-text-muted)", fontSize: 12 }}>—</span>}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} title="Edit permissions" onClick={() => openPerms(role)}>
                          <KeyRound size={13} />
                        </button>
                        {!role.is_system && (
                          <>
                            <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} title="Rename" onClick={() => setModal({ mode: "rename", role })}>
                              <Edit3 size={13} />
                            </button>
                            <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} title={role.status === "active" ? "Deactivate" : "Activate"} onClick={() => toggleStatus(role)}>
                              <Power size={13} />
                            </button>
                          </>
                        )}
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
          title={
            modal.mode === "create" ? "New Role"
              : modal.mode === "rename" ? "Rename Role"
              : `Permissions — ${modal.role.role_name}`
          }
          onClose={() => setModal(null)}
          width={modal.mode === "rename" ? 420 : 560}
        >
          <form onSubmit={handleSave}>
            {(modal.mode === "create" || modal.mode === "rename") && (
              <Field label="Role Name *">
                <input
                  className="ops-form-input"
                  name="roleName"
                  required
                  defaultValue={modal.role?.role_name || ""}
                  placeholder="Operations Manager"
                />
              </Field>
            )}

            {(modal.mode === "create" || modal.mode === "perms") && (
              <div style={{ marginTop: modal.mode === "create" ? 8 : 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
                  Permissions
                </div>
                <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, paddingRight: 4 }}>
                  {Object.keys(groups).sort().map((groupKey) => (
                    <div key={groupKey}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--trackify-text)", marginBottom: 5, textTransform: "capitalize" }}>
                        {groupKey}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {groups[groupKey].map((p) => (
                          <label key={p.permission_id} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              name="permissionIds"
                              value={p.permission_id}
                              defaultChecked={modal.selected ? modal.selected.has(p.permission_id) : false}
                              style={{ marginTop: 2 }}
                            />
                            <span>
                              <code style={{ fontSize: 12 }}>{p.permission_code}</code>
                              <span style={{ color: "var(--trackify-text-secondary)" }}> — {p.description}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
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

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, ShieldCheck, Edit3, Power, KeyRound } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import {
  listRoles,
  listPermissions,
  createRole,
  updateRole,
} from "../../services/admin/roleService";
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
import PermissionsModal from "./PermissionsModal";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

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
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [modal, setModal] = useState(null); // {mode:'create'} | {mode:'rename', role}
  const [permsRole, setPermsRole] = useState(null); // role whose permissions are being edited
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listRoles());
    } catch (err) {
      setError(err.message || "Failed to load roles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    listPermissions().then(setPermissions).catch(() => setPermissions([]));
  }, []);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (status === "all" || r.status === status) &&
        (!q || r.role_name.toLowerCase().includes(q))
    );
  }, [rows, search, status]);

  async function doToggle(role) {
    setConfirmBusy(true);
    try {
      await updateRole(role.role_id, {
        status: role.status === "active" ? "inactive" : "active",
      });
      addToast(role.status === "active" ? "Role deactivated" : "Role activated", "success");
      setConfirm(null);
      load();
    } catch (err) {
      addToast(err.message || "Update failed", "error");
    } finally {
      setConfirmBusy(false);
    }
  }

  function toggleStatus(role) {
    if (role.status === "active") setConfirm({ role });
    else doToggle(role);
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
    <SettingsPage
      eyebrow="User Management"
      title="Roles & Permissions"
      description="Define what each role can do within the current company."
      actions={
        <Can permission="role.manage">
          <Button variant="primary" icon={Plus} onClick={() => setModal({ mode: "create" })}>
            New Role
          </Button>
        </Can>
      }
    >
      <SettingsToolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search roles…" />
        <FilterButton label="Status" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
      </SettingsToolbar>

      <SettingsTable
        columns={[
          { key: "role", label: "Role" },
          { key: "perms", label: "Permissions" },
          { key: "users", label: "Users" },
          { key: "status", label: "Status" },
          { key: "actions", label: "Actions", align: "right" },
        ]}
        rows={visibleRows}
        loading={loading}
        error={error}
        onRetry={load}
        empty={{ icon: ShieldCheck, title: "No roles found" }}
        renderRow={(role) => (
          <tr key={role.role_id}>
            <td style={{ fontWeight: 600, color: "var(--text)" }}>{role.role_name}</td>
            <td>{role.permission_count}</td>
            <td>{role.user_count}</td>
            <td><StatusBadge status={role.status} /></td>
            <td style={{ textAlign: "right" }}>
              <Can permission="role.manage" fallback={<span style={{ color: "var(--text-3)", fontSize: 12 }}>—</span>}>
                <div style={{ display: "inline-flex", gap: 4 }}>
                  <Button variant="ghost" size="sm" icon={KeyRound} title="Edit permissions" aria-label="Edit permissions" onClick={() => setPermsRole(role)} />
                  {!role.is_system && (
                    <>
                      <Button variant="ghost" size="sm" icon={Edit3} title="Rename" aria-label="Rename" onClick={() => setModal({ mode: "rename", role })} />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Power}
                        title={role.status === "active" ? "Deactivate" : "Activate"}
                        aria-label={role.status === "active" ? "Deactivate" : "Activate"}
                        onClick={() => toggleStatus(role)}
                      />
                    </>
                  )}
                </div>
              </Can>
            </td>
          </tr>
        )}
      />

      {modal && (
        <Modal
          title={modal.mode === "create" ? "New Role" : "Rename Role"}
          onClose={() => setModal(null)}
          width={modal.mode === "rename" ? 420 : 560}
        >
          <form onSubmit={handleSave}>
            <Field label="Role Name *">
              <input
                className="ops-form-input"
                name="roleName"
                required
                defaultValue={modal.role?.role_name || ""}
                placeholder="Operations Manager"
              />
            </Field>

            {modal.mode === "create" && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
                  Permissions
                </div>
                <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, paddingRight: 4 }}>
                  {Object.keys(groups).sort().map((groupKey) => (
                    <div key={groupKey}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 5, textTransform: "capitalize" }}>
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
                              <span style={{ color: "var(--text-2)" }}> — {p.description}</span>
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
              <Button type="button" variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
              <Button type="submit" variant="primary" loading={saving}>Save</Button>
            </div>
          </form>
        </Modal>
      )}

      {permsRole && (
        <PermissionsModal
          role={permsRole}
          allPermissions={permissions}
          onClose={() => setPermsRole(null)}
          onSaved={() => { setPermsRole(null); load(); }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title="Deactivate role?"
          message={`"${confirm.role.role_name}" will be deactivated. Users keep the role on their account but its permissions stop applying until it's reactivated.`}
          confirmLabel="Deactivate"
          tone="danger"
          loading={confirmBusy}
          onConfirm={() => doToggle(confirm.role)}
          onClose={() => setConfirm(null)}
        />
      )}
    </SettingsPage>
  );
}

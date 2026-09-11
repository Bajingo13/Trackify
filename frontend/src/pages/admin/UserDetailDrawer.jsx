import { useCallback, useEffect, useState } from "react";
import {
  Building2, MapPin, Plus, ScrollText, ShieldCheck, AlertCircle,
} from "lucide-react";
import { Drawer, Button, EmptyState } from "../../components/ui";
import { ConfirmDialog, StatusBadge } from "../../components/settings";
import { useToast } from "../../components/shared/Toast";
import { getUser, grantUserAccess, setUserAccessStatus } from "../../services/admin/userService";
import { listBranches } from "../../services/admin/branchService";
import { listAuditLogs } from "../../services/admin/auditLogService";
import { usePermissions } from "../../auth/permissions";

function Pill({ children, tone = "accent" }) {
  const styles = tone === "muted"
    ? { background: "var(--surface-sunk)", color: "var(--text-3)" }
    : { background: "var(--accent-soft)", color: "var(--accent-ink)" };
  return (
    <span
      style={{
        padding: "3px 10px", borderRadius: "var(--r-pill)", fontSize: "var(--fs-11)", fontWeight: 600,
        border: "1px solid var(--line)", whiteSpace: "nowrap", ...styles,
      }}
    >
      {children}
    </span>
  );
}

function Section({ title, action, children }) {
  return (
    <div style={{ marginBottom: "var(--s-6)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--s-3)" }}>
        <h4 style={{ margin: 0, fontSize: "var(--fs-13)", fontWeight: 700, color: "var(--text)" }}>{title}</h4>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * Read-only "who is this user" view, plus the one write surface that has
 * nowhere else to live: granting/revoking the company/branch access rows
 * behind `user_company_access`.
 */
export default function UserDetailDrawer({ userId, onClose }) {
  const { can } = usePermissions();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [branches, setBranches] = useState([]);
  const [activity, setActivity] = useState(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [granting, setGranting] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revoking, setRevoking] = useState(false);
  const [reactivatingId, setReactivatingId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getUser(userId)
      .then(setDetail)
      .catch((err) => setError(err.message || "Failed to load user"))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!can("branch.read")) { setBranches([]); return; }
    listBranches({ status: "active" }).then(setBranches).catch(() => setBranches([]));
  }, [can]);

  useEffect(() => {
    if (!can("audit.read")) { setActivity([]); return; }
    listAuditLogs({ userId, limit: 8 })
      .then((res) => setActivity(res.data))
      .catch(() => setActivity([]));
  }, [userId, can]);

  const canManage = can("user.manage");
  const fullName = detail ? `${detail.first_name} ${detail.last_name}` : "";
  const uniqueRoles = detail
    ? [...new Map((detail.roles || []).map((r) => [r.role_name, r])).values()]
    : [];
  const activeAccess = detail ? (detail.access || []).filter((a) => a.status === "active") : [];
  const inactiveAccess = detail ? (detail.access || []).filter((a) => a.status !== "active") : [];

  async function handleGrant(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setGranting(true);
    try {
      await grantUserAccess(userId, {
        branchId: form.get("branchId") || null,
        effectiveFrom: form.get("effectiveFrom") || null,
        effectiveTo: form.get("effectiveTo") || null,
      });
      addToast("Access granted", "success");
      setGrantOpen(false);
      load();
    } catch (err) {
      addToast(err.message || "Failed to grant access", "error");
    } finally {
      setGranting(false);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await setUserAccessStatus(userId, revokeTarget.access_id, "inactive");
      addToast("Access revoked", "success");
      setRevokeTarget(null);
      load();
    } catch (err) {
      addToast(err.message || "Failed to revoke access", "error");
    } finally {
      setRevoking(false);
    }
  }

  // Reactivating is restorative, not destructive — no confirmation needed, and
  // it updates the existing row in place rather than sending you back through
  // "Grant access" to recreate it.
  async function handleReactivate(a) {
    setReactivatingId(a.access_id);
    try {
      await setUserAccessStatus(userId, a.access_id, "active");
      addToast("Access reactivated", "success");
      load();
    } catch (err) {
      addToast(err.message || "Failed to reactivate access", "error");
    } finally {
      setReactivatingId(null);
    }
  }

  return (
    <>
      <Drawer open onClose={onClose} title="User details" width={480}>
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[48, 70, 90].map((h, i) => (
              <div key={i} style={{ height: h, borderRadius: "var(--r-sm)", background: "var(--surface-2)" }} />
            ))}
          </div>
        ) : error ? (
          <EmptyState icon={AlertCircle} title="Couldn't load this user" hint={error} />
        ) : (
          <>
            {/* identity */}
            <div style={{ display: "flex", alignItems: "center", gap: "var(--s-3)", marginBottom: "var(--s-6)" }}>
              <span
                style={{
                  width: 52, height: 52, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
                  background: "linear-gradient(135deg, var(--brand-blue), var(--brand-navy))",
                  color: "#fff", fontSize: "var(--fs-18)", fontWeight: 700,
                }}
              >
                {detail.first_name?.[0]?.toUpperCase() || "U"}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "var(--fs-15)", fontWeight: 700, color: "var(--text)" }}>{fullName}</div>
                <div style={{ fontSize: "var(--fs-12)", color: "var(--text-3)", overflowWrap: "anywhere" }}>{detail.email}</div>
                <div style={{ marginTop: 6 }}><StatusBadge status={detail.status} /></div>
              </div>
            </div>

            {/* roles */}
            <Section title="Roles">
              {uniqueRoles.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {uniqueRoles.map((r) => (
                    <Pill key={r.role_id} tone={r.status === "active" ? "accent" : "muted"}>
                      <ShieldCheck size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
                      {r.role_name}{r.status !== "active" ? " (inactive)" : ""}
                    </Pill>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: "var(--fs-12)", color: "var(--text-3)" }}>No roles assigned.</p>
              )}
            </Section>

            {/* access */}
            <Section
              title="Company / branch access"
              action={canManage && !detail.isSystemAdmin && (
                <Button size="sm" variant="secondary" icon={Plus} onClick={() => setGrantOpen((v) => !v)}>
                  Grant access
                </Button>
              )}
            >
              {detail.isSystemAdmin ? (
                <div
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
                    background: "var(--accent-soft)", border: "1px solid var(--line)",
                    borderRadius: "var(--r-sm)", fontSize: "var(--fs-12)", color: "var(--text)",
                  }}
                >
                  <ShieldCheck size={15} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }} />
                  <span>
                    This user is a <strong>System Administrator</strong> — they have access to every company and
                    branch automatically, so there's nothing to grant or revoke here.
                  </span>
                </div>
              ) : (
              <>
              {grantOpen && (
                <form
                  onSubmit={handleGrant}
                  style={{
                    display: "flex", flexDirection: "column", gap: 8, padding: "var(--s-3)",
                    border: "1px solid var(--line)", borderRadius: "var(--r-sm)", background: "var(--surface-2)",
                    marginBottom: "var(--s-3)",
                  }}
                >
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontSize: "var(--fs-11)", fontWeight: 600, color: "var(--text-2)" }}>Branch</span>
                    <select className="ops-form-input" name="branchId" defaultValue="">
                      <option value="">Company-wide (all branches)</option>
                      {branches.map((b) => (
                        <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>
                      ))}
                    </select>
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                      <span style={{ fontSize: "var(--fs-11)", fontWeight: 600, color: "var(--text-2)" }}>From (optional)</span>
                      <input className="ops-form-input" type="date" name="effectiveFrom" />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                      <span style={{ fontSize: "var(--fs-11)", fontWeight: 600, color: "var(--text-2)" }}>Until (optional)</span>
                      <input className="ops-form-input" type="date" name="effectiveTo" />
                    </label>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setGrantOpen(false)}>Cancel</Button>
                    <Button type="submit" size="sm" variant="primary" loading={granting}>Grant</Button>
                  </div>
                </form>
              )}

              {activeAccess.length === 0 && inactiveAccess.length === 0 ? (
                <p style={{ margin: 0, fontSize: "var(--fs-12)", color: "var(--text-3)" }}>No access on record.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[...activeAccess, ...inactiveAccess].map((a) => (
                    <div
                      key={a.access_id}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                        border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
                        background: a.status === "active" ? "transparent" : "var(--surface-2)",
                      }}
                    >
                      <Building2 size={14} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "var(--fs-12)", fontWeight: 600, color: "var(--text)" }}>{a.company_name}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "var(--fs-11)", color: "var(--text-3)" }}>
                          <MapPin size={11} />
                          {a.branch_name || "All branches"}
                          {(a.effective_from || a.effective_to) && (
                            <span>
                              {" · "}
                              {a.effective_from ? new Date(a.effective_from).toLocaleDateString() : "…"}
                              {" – "}
                              {a.effective_to ? new Date(a.effective_to).toLocaleDateString() : "…"}
                            </span>
                          )}
                        </div>
                      </div>
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => (a.status === "active" ? setRevokeTarget(a) : handleReactivate(a))}
                          disabled={reactivatingId === a.access_id}
                          title={a.status === "active" ? "Click to revoke" : "Click to reactivate"}
                          style={{
                            border: "none", background: "transparent", padding: 0, borderRadius: "var(--r-pill)",
                            cursor: reactivatingId === a.access_id ? "wait" : "pointer",
                            opacity: reactivatingId === a.access_id ? 0.6 : 1,
                          }}
                        >
                          <StatusBadge status={a.status} />
                        </button>
                      ) : (
                        <StatusBadge status={a.status} />
                      )}
                    </div>
                  ))}
                </div>
              )}
              </>
              )}
            </Section>

            {/* recent activity */}
            <Section title="Recent activity">
              {activity === null ? (
                <p style={{ margin: 0, fontSize: "var(--fs-12)", color: "var(--text-3)" }}>Loading…</p>
              ) : activity.length === 0 ? (
                <EmptyState icon={ScrollText} title="No recent activity" />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {activity.map((a) => (
                    <div key={a.audit_id} style={{ display: "flex", flexDirection: "column", gap: 1, padding: "6px 0", borderBottom: "1px solid var(--line-soft)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text)" }}>{a.action}</code>
                        <span style={{ fontSize: "var(--fs-11)", color: "var(--text-3)", whiteSpace: "nowrap" }}>
                          {new Date(a.created_at).toLocaleString()}
                        </span>
                      </div>
                      {a.summary && <div style={{ fontSize: "var(--fs-12)", color: "var(--text-2)" }}>{a.summary}</div>}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </>
        )}
      </Drawer>

      {revokeTarget && (
        <ConfirmDialog
          title="Revoke access?"
          message={`This removes ${fullName}'s access to ${revokeTarget.company_name}${revokeTarget.branch_name ? ` · ${revokeTarget.branch_name}` : " (all branches)"}. They can be re-granted access later.`}
          confirmLabel="Revoke"
          tone="danger"
          loading={revoking}
          onConfirm={handleRevoke}
          onClose={() => setRevokeTarget(null)}
        />
      )}
    </>
  );
}

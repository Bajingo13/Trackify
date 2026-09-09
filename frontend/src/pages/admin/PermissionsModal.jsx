import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { X, ChevronDown, AlertTriangle, ShieldOff, SearchX } from "lucide-react";
import { backdrop, scaleIn } from "../../motion";
import { Button, EmptyState } from "../../components/ui";
import { SearchInput, ConfirmDialog } from "../../components/settings";
import { useToast } from "../../components/shared/Toast";
import useMediaQuery from "../../hooks/useMediaQuery";
import { usePermissions } from "../../auth/permissions";
import { getRole, setRolePermissions } from "../../services/admin/roleService";
import {
  groupPermissions,
  buildDeps,
  diffPermissions,
  permissionMatches,
  SENSITIVE_CODES,
} from "./permissionsModalUtils";

/* ---------------- permission row ---------------- */
function PermissionRow({ perm, checked, disabled, sensitive, onToggle }) {
  return (
    <label
      title={disabled ? "You don't hold this permission, so you can't grant it" : undefined}
      style={{
        display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 8px",
        borderRadius: "var(--r-xs)", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "var(--surface-2)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={() => onToggle(perm)}
        style={{ marginTop: 2, flexShrink: 0, accentColor: "var(--accent)" }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          {sensitive && (
            <AlertTriangle size={12} style={{ color: "var(--warn)", flexShrink: 0 }} aria-hidden="true" />
          )}
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)", overflowWrap: "anywhere" }}>
            {perm.permission_code}
          </code>
          {sensitive && <span className="tk-sr-only"> (sensitive permission)</span>}
        </span>
        {perm.description && (
          <span style={{ display: "block", fontSize: "var(--fs-12)", color: "var(--text-3)", marginTop: 1 }}>
            {perm.description}
          </span>
        )}
      </span>
    </label>
  );
}

/* ---------------- group ---------------- */
function PermissionGroup({
  group, visible, selectedCount, total, expanded,
  onToggleCollapse, onToggleGroup, onTogglePerm, isChecked, isDisabled, isSensitive,
}) {
  const cbRef = useRef(null);
  const allOn = total > 0 && selectedCount === total;
  const some = selectedCount > 0 && selectedCount < total;

  useEffect(() => {
    if (cbRef.current) cbRef.current.indeterminate = some;
  }, [some]);

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r-sm)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--surface-2)" }}>
        <input
          ref={cbRef}
          type="checkbox"
          checked={allOn}
          onChange={(e) => onToggleGroup(e.target.checked)}
          aria-label={`Select all ${group.group} permissions`}
          style={{ flexShrink: 0, accentColor: "var(--accent)" }}
        />
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={expanded}
          style={{
            flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8,
            border: "none", background: "transparent", cursor: "pointer", padding: 0, textAlign: "left",
            fontSize: "var(--fs-13)", fontWeight: 700, color: "var(--text)",
          }}
        >
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {group.group}
          </span>
          <span className="tk-mono" style={{ fontSize: "var(--fs-12)", fontWeight: 600, color: "var(--text-3)" }}>
            {selectedCount} / {total}
          </span>
          <motion.span animate={{ rotate: expanded ? 0 : -90 }} transition={{ duration: 0.18 }} style={{ display: "inline-flex", color: "var(--text-3)" }}>
            <ChevronDown size={15} />
          </motion.span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ padding: "4px 6px 6px" }}>
              {visible.map((p) => (
                <PermissionRow
                  key={p.permission_id}
                  perm={p}
                  checked={isChecked(p.permission_id)}
                  disabled={isDisabled(p.permission_code)}
                  sensitive={isSensitive(p.permission_code)}
                  onToggle={onTogglePerm}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------- modal ---------------- */
export default function PermissionsModal({ role, allPermissions, onClose, onSaved }) {
  const { addToast } = useToast();
  const { permissions: actorCodes, isSystemAdmin } = usePermissions();
  const fullScreen = useMediaQuery("(max-width: 640px)");

  const [loadState, setLoadState] = useState("loading"); // loading | ready | error
  const [initial, setInitial] = useState(() => new Set());
  const [current, setCurrent] = useState(() => new Set());
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [confirm, setConfirm] = useState(null); // null | 'discard' | 'save'
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const searchRef = useRef(null);
  const triggerRef = useRef(typeof document !== "undefined" ? document.activeElement : null);

  const actorSet = useMemo(() => new Set(actorCodes || []), [actorCodes]);
  const catalogById = useMemo(
    () => new Map((allPermissions || []).map((p) => [p.permission_id, p])),
    [allPermissions]
  );
  const deps = useMemo(() => buildDeps(allPermissions || []), [allPermissions]);
  const groups = useMemo(() => groupPermissions(allPermissions || []), [allPermissions]);

  const grantable = useCallback(
    (code) => isSystemAdmin || actorSet.has(code),
    [isSystemAdmin, actorSet]
  );

  /* ---- load the role's current permissions ---- */
  const loadRole = useCallback(() => {
    setLoadState("loading");
    getRole(role.role_id)
      .then((detail) => {
        const ids = new Set((detail.permissions || []).map((p) => p.permission_id));
        setInitial(ids);
        setCurrent(new Set(ids));
        setLoadState("ready");
      })
      .catch(() => setLoadState("error"));
  }, [role.role_id]);

  useEffect(() => { loadRole(); }, [loadRole]);

  /* ---- body scroll lock (re-assert after a nested ConfirmDialog closes) ---- */
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);
  useEffect(() => { if (!confirm) document.body.style.overflow = "hidden"; }, [confirm]);

  /* ---- focus mgmt ---- */
  useEffect(() => {
    if (loadState === "ready") searchRef.current?.focus();
  }, [loadState]);
  useEffect(() => {
    const trigger = triggerRef.current;
    return () => { if (trigger && typeof trigger.focus === "function") trigger.focus(); };
  }, []);

  /* ---- derived ---- */
  const { added, removed } = useMemo(() => diffPermissions(initial, current), [initial, current]);
  const hasChanges = added.length > 0 || removed.length > 0;
  const totalCount = allPermissions?.length || 0;
  const counterText = `${current.size} of ${totalCount} permission${totalCount === 1 ? "" : "s"} selected`;

  const filteredGroups = useMemo(() => {
    return groups
      .map((g) => ({
        ...g,
        visible: g.permissions.filter((p) => permissionMatches(p, g.group, query)),
      }))
      .filter((g) => g.visible.length > 0);
  }, [groups, query]);

  const noResults = query.trim() && filteredGroups.length === 0;

  /* ---- actions ---- */
  const isChecked = useCallback((id) => current.has(id), [current]);
  const isDisabled = useCallback((code) => !grantable(code), [grantable]);
  const isSensitive = useCallback((code) => SENSITIVE_CODES.has(code), []);

  const togglePerm = useCallback((perm) => {
    if (!grantable(perm.permission_code)) return;
    setCurrent((prev) => {
      const next = new Set(prev);
      if (next.has(perm.permission_id)) {
        // block if a still-selected permission depends on this one
        const blockedBy = [...next].find((id) => (deps.get(id) || []).includes(perm.permission_id));
        if (blockedBy) {
          const dependent = catalogById.get(blockedBy);
          addToast(
            `${perm.permission_code} is required by ${dependent?.permission_code || "another permission"}`,
            "info"
          );
          return prev;
        }
        next.delete(perm.permission_id);
      } else {
        next.add(perm.permission_id);
        for (const depId of deps.get(perm.permission_id) || []) next.add(depId);
      }
      return next;
    });
  }, [grantable, deps, catalogById, addToast]);

  const toggleGroup = useCallback((groupObj, checked) => {
    setCurrent((prev) => {
      const next = new Set(prev);
      for (const p of groupObj.permissions) {
        if (!grantable(p.permission_code)) continue;
        if (checked) {
          next.add(p.permission_id);
          for (const depId of deps.get(p.permission_id) || []) next.add(depId);
        } else {
          next.delete(p.permission_id);
        }
      }
      return next;
    });
  }, [grantable, deps]);

  const selectAll = useCallback(() => {
    setCurrent((prev) => {
      const next = new Set(prev); // keep non-grantable picks that were already there
      for (const p of allPermissions) if (grantable(p.permission_code)) next.add(p.permission_id);
      return next;
    });
  }, [allPermissions, grantable]);

  const unselectAll = useCallback(() => {
    // keep permissions the actor can't toggle anyway
    setCurrent((prev) => {
      const next = new Set();
      for (const id of prev) {
        const p = catalogById.get(id);
        if (p && !grantable(p.permission_code)) next.add(id);
      }
      return next;
    });
  }, [catalogById, grantable]);

  const toggleCollapse = useCallback((key) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const requestClose = useCallback(() => {
    if (saving) return;
    if (hasChanges) setConfirm("discard");
    else onClose();
  }, [saving, hasChanges, onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !confirm) { e.stopPropagation(); requestClose(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [confirm, requestClose]);

  const mapError = (err) => {
    switch (err?.status) {
      case 401: return "Your session has expired. Please sign in again.";
      case 403: return err.message || "You can't grant permissions you don't hold yourself.";
      case 409: return err.message || "This change would leave the company without an active administrator.";
      case 404: return "This role no longer exists. Close and refresh the list.";
      default: return err?.message || "Something went wrong on our end. Please try again.";
    }
  };

  const doSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await setRolePermissions(role.role_id, [...current]);
      addToast("Permissions updated successfully.", "success");
      onSaved();
    } catch (err) {
      setConfirm(null);
      setSaving(false);
      setSaveError(mapError(err));
    }
  };

  const sensitiveAdded = added
    .map((id) => catalogById.get(id)?.permission_code)
    .filter((c) => c && SENSITIVE_CODES.has(c));

  /* ---- render ---- */
  const body = (() => {
    if (loadState === "loading") {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 4 }}>
          {[64, 40, 40, 56, 40, 40, 48].map((h, i) => (
            <motion.div
              key={i}
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.08 }}
              style={{ height: h, borderRadius: "var(--r-sm)", background: "var(--surface-2)" }}
            />
          ))}
        </div>
      );
    }
    if (loadState === "error") {
      return (
        <div style={{ padding: "var(--s-6) 0" }}>
          <EmptyState icon={ShieldOff} title="Couldn't load this role's permissions" hint="The request failed. Check your connection and try again." />
          <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
            <Button variant="secondary" size="sm" onClick={loadRole}>Retry</Button>
          </div>
        </div>
      );
    }
    if (totalCount === 0) {
      return (
        <div style={{ padding: "var(--s-6) 0" }}>
          <EmptyState icon={ShieldOff} title="No permissions available" hint="There are currently no permissions configured for this system." />
        </div>
      );
    }
    return (
      <>
        {saveError && (
          <div
            role="alert"
            style={{
              display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
              background: "var(--danger-soft)", border: "1px solid var(--danger-line)",
              borderRadius: "var(--r-sm)", fontSize: "var(--fs-13)", color: "var(--text)",
            }}
          >
            <AlertTriangle size={15} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>Unable to save permission changes.</div>
              <div style={{ color: "var(--text-2)", marginTop: 2 }}>{saveError} Your selections have not been lost.</div>
              <div style={{ marginTop: 8 }}>
                <Button size="sm" variant="secondary" onClick={() => { setSaveError(null); setConfirm("save"); }}>
                  Try again
                </Button>
              </div>
            </div>
          </div>
        )}

        <SearchInput value={query} onChange={setQuery} placeholder="Search permissions…" width="100%" />

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Button size="sm" variant="secondary" onClick={selectAll}>Select all</Button>
          <Button size="sm" variant="ghost" onClick={unselectAll}>Unselect all</Button>
          <span aria-live="polite" style={{ marginLeft: "auto", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
            {counterText}
          </span>
        </div>

        {noResults ? (
          <div style={{ padding: "var(--s-6) 0" }}>
            <EmptyState icon={SearchX} title="No permissions found" hint="Try a different permission, group, or keyword." />
            <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
              <Button variant="secondary" size="sm" onClick={() => setQuery("")}>Clear search</Button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredGroups.map((g) => {
              const selectedCount = g.permissions.filter((p) => current.has(p.permission_id)).length;
              return (
                <PermissionGroup
                  key={g.key}
                  group={g}
                  visible={g.visible}
                  selectedCount={selectedCount}
                  total={g.permissions.length}
                  expanded={!collapsed.has(g.key) || Boolean(query.trim())}
                  onToggleCollapse={() => toggleCollapse(g.key)}
                  onToggleGroup={(checked) => toggleGroup(g, checked)}
                  onTogglePerm={togglePerm}
                  isChecked={isChecked}
                  isDisabled={isDisabled}
                  isSensitive={isSensitive}
                />
              );
            })}
          </div>
        )}
      </>
    );
  })();

  return createPortal(
    <>
      <motion.div
        className="tk-scope"
        variants={backdrop}
        initial="hidden"
        animate="show"
        exit="exit"
        onMouseDown={requestClose}
        style={{
          position: "fixed", inset: 0, background: "var(--overlay)", zIndex: 9000,
          display: "flex", alignItems: fullScreen ? "stretch" : "flex-start",
          justifyContent: "center", padding: fullScreen ? 0 : "56px 20px",
        }}
      >
        <motion.div
          variants={scaleIn}
          initial="hidden"
          animate="show"
          exit="exit"
          role="dialog"
          aria-modal="true"
          aria-labelledby="perm-modal-title"
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            width: fullScreen ? "100vw" : "min(680px, 100vw - 40px)",
            maxHeight: fullScreen ? "100dvh" : "calc(100dvh - 112px)",
            height: fullScreen ? "100dvh" : undefined,
            background: "var(--surface)", border: "1px solid var(--line)",
            borderRadius: fullScreen ? 0 : "var(--r-lg)", boxShadow: "var(--shadow-3)",
            overflow: "hidden", display: "flex", flexDirection: "column",
          }}
        >
          {/* header */}
          <div
            style={{
              display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
              padding: "13px 18px", borderBottom: "1px solid var(--line)", background: "var(--surface-2)", flexShrink: 0,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-pixel)", fontSize: 10, letterSpacing: "1.4px", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 3 }}>
                Permissions
              </div>
              <h3 id="perm-modal-title" style={{ margin: 0, fontSize: "var(--fs-15)", fontWeight: 700, color: "var(--text)" }}>
                {role.role_name}
              </h3>
              {role.description && (
                <p style={{ margin: "3px 0 0", fontSize: "var(--fs-12)", color: "var(--text-2)", lineHeight: 1.5 }}>
                  {role.description}
                </p>
              )}
            </div>
            <button
              onClick={requestClose}
              aria-label="Close"
              style={{ display: "inline-flex", padding: 5, border: "none", background: "transparent", cursor: "pointer", color: "var(--text-2)", borderRadius: "var(--r-xs)", flexShrink: 0 }}
            >
              <X size={16} />
            </button>
          </div>

          {/* body */}
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--s-5)", display: "flex", flexDirection: "column", gap: 12 }}>
            {body}
          </div>

          {/* sticky footer */}
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
              padding: "12px 18px", borderTop: "1px solid var(--line)", background: "var(--surface)", flexShrink: 0,
            }}
          >
            <span style={{ fontSize: "var(--fs-12)", color: "var(--text-3)" }}>{counterText}</span>
            <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
              <Button variant="ghost" onClick={requestClose} disabled={saving}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!hasChanges || saving || loadState !== "ready"}
                onClick={() => setConfirm("save")}
              >
                Save Changes
              </Button>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {confirm === "discard" && (
        <ConfirmDialog
          title="Discard changes?"
          message="You have unsaved permission changes. Are you sure you want to discard them? Your changes will not be saved."
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          tone="danger"
          onConfirm={() => { setConfirm(null); onClose(); }}
          onClose={() => setConfirm(null)}
        />
      )}

      {confirm === "save" && (
        <ConfirmDialog
          title="Confirm permission changes"
          confirmLabel={saving ? "Saving…" : "Confirm & Save"}
          cancelLabel="Cancel"
          tone="primary"
          loading={saving}
          onConfirm={doSave}
          onClose={() => { if (!saving) setConfirm(null); }}
        >
          <p style={{ margin: "0 0 8px", fontSize: "var(--fs-13)", color: "var(--text-2)" }}>
            You're about to update the permissions for{" "}
            <strong style={{ color: "var(--text)" }}>{role.role_name}</strong>.
          </p>
          <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: "var(--fs-13)", color: "var(--text)" }}>
            <li>{added.length} permission{added.length === 1 ? "" : "s"} will be enabled.</li>
            <li>
              {removed.length > 0
                ? `${removed.length} permission${removed.length === 1 ? "" : "s"} will be removed.`
                : "No permissions will be removed."}
            </li>
          </ul>
          {sensitiveAdded.length > 0 && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", background: "var(--warn-soft)", border: "1px solid var(--warn)", borderRadius: "var(--r-sm)", fontSize: "var(--fs-12)", color: "var(--text)" }}>
              <AlertTriangle size={14} style={{ color: "var(--warn)", flexShrink: 0, marginTop: 1 }} />
              <span>
                This adds administrative permissions ({sensitiveAdded.join(", ")}) that let holders change
                access for other users. These changes affect everyone assigned to this role.
              </span>
            </div>
          )}
          {sensitiveAdded.length === 0 && (
            <p style={{ margin: 0, fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
              These changes will affect users assigned to this role.
            </p>
          )}
        </ConfirmDialog>
      )}
    </>,
    document.body
  );
}

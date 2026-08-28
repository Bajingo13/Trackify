const auditLogs = [];
let auditId = 1;

export function logAudit({ module, action, referenceId, previousValue, newValue, reason, userId = 4, userName = "Super Admin" }) {
  auditLogs.unshift({
    id: auditId++,
    module,
    action,
    referenceId,
    previousValue: previousValue ? JSON.parse(JSON.stringify(previousValue)) : null,
    newValue: newValue ? JSON.parse(JSON.stringify(newValue)) : null,
    reason: reason || "",
    userId,
    userName,
    timestamp: new Date().toISOString(),
  });
}

export function getAuditLogs(filters = {}) {
  let result = [...auditLogs];
  if (filters.module) result = result.filter((l) => l.module === filters.module);
  if (filters.referenceId) result = result.filter((l) => String(l.referenceId) === String(filters.referenceId));
  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.module.toLowerCase().includes(q) ||
        l.userName.toLowerCase().includes(q) ||
        (l.reason && l.reason.toLowerCase().includes(q))
    );
  }
  return result;
}

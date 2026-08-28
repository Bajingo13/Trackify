import { useState, useEffect, useCallback } from "react";
import { Search, ScrollText, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import { PageShell, TableCard } from "../../components/shared/crud";
import { listAuditLogs } from "../../services/admin/auditLogService";

const MODULES = ["all", "admin", "master-data", "operations"];

export default function AuditLogsPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, pagination } = await listAuditLogs({
        search,
        module: moduleFilter,
        page,
        limit: 25,
      });
      setRows(data);
      if (pagination) setPagination(pagination);
    } catch (err) {
      addToast(err.message || "Failed to load audit log", "error");
    } finally {
      setLoading(false);
    }
  }, [search, moduleFilter, page, addToast]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [search, moduleFilter]);

  return (
    <PageShell title="Audit Logs" subtitle="A record of every change made through Trackify">
      <div className="ops-card" style={{ marginBottom: 14 }}>
        <div className="ops-filters" style={{ gap: 10, flexWrap: "wrap" }}>
          <div className="ops-search">
            <Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search action, summary, user..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="ops-form-input"
            style={{ maxWidth: 180 }}
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
          >
            {MODULES.map((m) => (
              <option key={m} value={m}>{m === "all" ? "All modules" : m}</option>
            ))}
          </select>
        </div>
      </div>

      <TableCard>
        <table className="ops-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Module</th>
              <th>Action</th>
              <th>Summary</th>
              <th>User</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5}><div className="ops-empty"><div className="ops-empty-desc">Loading…</div></div></td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="ops-empty">
                    <div className="ops-empty-icon"><ScrollText size={32} /></div>
                    <div className="ops-empty-title">No audit entries</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.audit_id}>
                  <td style={{ whiteSpace: "nowrap" }}>{new Date(row.created_at).toLocaleString()}</td>
                  <td>{row.module}</td>
                  <td><code style={{ fontSize: 12 }}>{row.action}</code></td>
                  <td>{row.summary || "—"}</td>
                  <td>{row.actor || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", borderTop: "1px solid var(--trackify-border-soft)" }}>
          <span style={{ fontSize: 12, color: "var(--trackify-text-secondary)" }}>
            {pagination.total} {pagination.total === 1 ? "entry" : "entries"}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="ops-btn ops-btn-ghost"
              style={{ padding: "4px 8px" }}
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontSize: 12, color: "var(--trackify-text-secondary)" }}>
              Page {pagination.page} of {pagination.totalPages || 1}
            </span>
            <button
              className="ops-btn ops-btn-ghost"
              style={{ padding: "4px 8px" }}
              disabled={page >= (pagination.totalPages || 1)}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </TableCard>
    </PageShell>
  );
}

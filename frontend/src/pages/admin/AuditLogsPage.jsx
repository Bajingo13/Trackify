import { useState, useEffect, useCallback } from "react";
import { ScrollText, ChevronLeft, ChevronRight } from "lucide-react";
import { PageShell } from "../../components/shared/crud";
import { Button } from "../../components/ui";
import {
  SettingsPage,
  SettingsToolbar,
  SearchInput,
  FilterButton,
  SettingsTable,
} from "../../components/settings";
import { listAuditLogs } from "../../services/admin/auditLogService";

const MODULE_OPTIONS = [
  { value: "all", label: "All modules" },
  { value: "admin", label: "Admin" },
  { value: "master-data", label: "Master data" },
  { value: "operations", label: "Operations" },
];

/**
 * Renders in two places:
 *  - standalone (`/admin/audit-logs`) for reviewers who reach it from the main
 *    nav — wrapped in the full PageShell.
 *  - `embedded` inside the Settings workspace (`/admin/settings/audit-logs`) for
 *    admins — rendered into the Settings shell.
 */
export default function AuditLogsPage({ embedded = false }) {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
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
      setError(err.message || "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [search, moduleFilter, page]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [search, moduleFilter]);

  const totalPages = pagination.totalPages || 1;

  const body = (
    <>
      <SettingsToolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search action, summary, user…" />
        <FilterButton label="Module" value={moduleFilter} options={MODULE_OPTIONS} onChange={setModuleFilter} />
      </SettingsToolbar>

      <SettingsTable
        columns={[
          { key: "when", label: "When" },
          { key: "module", label: "Module" },
          { key: "action", label: "Action" },
          { key: "summary", label: "Summary" },
          { key: "user", label: "User" },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={load}
        empty={{
          icon: ScrollText,
          title: "No audit entries",
          hint: search || moduleFilter !== "all" ? "Try clearing the filters." : undefined,
        }}
        renderRow={(row) => (
          <tr key={row.audit_id}>
            <td style={{ whiteSpace: "nowrap" }}>{new Date(row.created_at).toLocaleString()}</td>
            <td>{row.module}</td>
            <td><code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{row.action}</code></td>
            <td>{row.summary || "—"}</td>
            <td>{row.actor || "—"}</td>
          </tr>
        )}
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "var(--s-3)" }}>
        <span style={{ fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
          {pagination.total} {pagination.total === 1 ? "entry" : "entries"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button
            variant="ghost"
            size="sm"
            icon={ChevronLeft}
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          />
          <span style={{ fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
            Page {pagination.page} of {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={ChevronRight}
            aria-label="Next page"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          />
        </div>
      </div>
    </>
  );

  if (embedded) {
    return (
      <SettingsPage
        eyebrow="System"
        title="Audit Log"
        description="A record of every change made through Trackify."
      >
        {body}
      </SettingsPage>
    );
  }

  return (
    <PageShell
      eyebrow="Administration"
      title="Audit Log"
      subtitle="A record of every change made through Trackify."
    >
      {body}
    </PageShell>
  );
}

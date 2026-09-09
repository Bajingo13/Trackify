import { TableCard } from "../shared/crud";
import { EmptyState, Button } from "../ui";
import { AlertCircle } from "lucide-react";

/**
 * Data table for Settings modules. Wraps the shared TableCard + `.ops-table`
 * styling and folds in the loading / empty / error states so each CRUD page
 * stops re-implementing the same `<table>` scaffold.
 *
 *   <SettingsTable
 *     columns={[{ key: "name", label: "Name" }, { key: "actions", label: "Actions", align: "right" }]}
 *     rows={rows}
 *     loading={loading}
 *     error={error}
 *     onRetry={load}
 *     empty={{ icon: Building2, title: "No companies found" }}
 *     renderRow={(row) => <tr key={row.id}>…</tr>}
 *   />
 */
export default function SettingsTable({ columns, rows, renderRow, loading, error, onRetry, empty }) {
  const span = columns.length;

  return (
    <TableCard>
      <table className="ops-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align || "left", width: c.width }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={span}>
                <div className="ops-empty"><div className="ops-empty-desc">Loading…</div></div>
              </td>
            </tr>
          ) : error ? (
            <tr>
              <td colSpan={span}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "var(--s-10) var(--s-4)", textAlign: "center" }}>
                  <span style={{ width: 40, height: 40, borderRadius: "var(--r-md)", background: "var(--danger-soft)", color: "var(--danger)", display: "grid", placeItems: "center" }}>
                    <AlertCircle size={18} />
                  </span>
                  <div style={{ fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text)" }}>{error}</div>
                  {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>}
                </div>
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={span}>
                <EmptyState icon={empty?.icon} title={empty?.title || "Nothing here yet"} hint={empty?.hint} />
              </td>
            </tr>
          ) : (
            rows.map(renderRow)
          )}
        </tbody>
      </table>
    </TableCard>
  );
}

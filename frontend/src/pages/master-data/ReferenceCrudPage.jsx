import { useState, useEffect, useCallback } from "react";
import { Plus, Search, Database, Edit3, Power } from "lucide-react";
import { useToast } from "../../components/shared/Toast";
import { PageShell, StatusPill, Modal, Field, TableCard } from "../../components/shared/crud";
import { Can } from "../../auth/permissions";

/**
 * Config-driven CRUD screen for the simple master-data reference tables
 * (suppliers, items, warehouses, chart of accounts, tax codes).
 *
 * config = {
 *   title, subtitle, perm, idKey, service,
 *   columns: [{ label, render:(row)=>node }],
 *   fields:  [{ name, label, type?, required?, options?, half?, get:(row)=>value }],
 *   toPayload?: (formObj) => payload   // optional shaping before send
 * }
 */
export default function ReferenceCrudPage({ config }) {
  const { title, subtitle, perm, idKey, service, columns, fields, toPayload } = config;
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null); // {mode:'create'} | {mode:'edit', row}
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await service.list({ search });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      addToast(err.message || `Failed to load ${title.toLowerCase()}`, "error");
    } finally {
      setLoading(false);
    }
  }, [service, search, title, addToast]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function toggleStatus(row) {
    try {
      await service.update(row[idKey], {
        status: row.status === "active" ? "inactive" : "active",
      });
      addToast(`${title.replace(/s$/, "")} updated`, "success");
      load();
    } catch (err) {
      addToast(err.message || "Update failed", "error");
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    const form = new FormData(e.target);
    let payload = {};
    for (const f of fields) {
      const raw = form.get(f.name);
      payload[f.name] = f.type === "number" ? (raw === "" ? null : Number(raw)) : raw;
    }
    if (toPayload) payload = toPayload(payload, modal);
    setSaving(true);
    try {
      if (modal.mode === "create") {
        await service.create(payload);
        addToast(`${title.replace(/s$/, "")} created`, "success");
      } else {
        await service.update(modal.row[idKey], payload);
        addToast(`${title.replace(/s$/, "")} updated`, "success");
      }
      setModal(null);
      load();
    } catch (err) {
      addToast(err.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  const colCount = columns.length + 2;

  return (
    <PageShell
      title={title}
      subtitle={subtitle}
      actions={
        <Can permission={`${perm}.manage`}>
          <button className="ops-btn ops-btn-primary" onClick={() => setModal({ mode: "create" })}>
            <Plus size={15} /> New
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
              placeholder={`Search ${title.toLowerCase()}...`}
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
              {columns.map((c) => (
                <th key={c.label}>{c.label}</th>
              ))}
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colCount}><div className="ops-empty"><div className="ops-empty-desc">Loading…</div></div></td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount}>
                  <div className="ops-empty">
                    <div className="ops-empty-icon"><Database size={32} /></div>
                    <div className="ops-empty-title">No {title.toLowerCase()} found</div>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row[idKey]}>
                  {columns.map((c) => (
                    <td key={c.label}>{c.render(row)}</td>
                  ))}
                  <td><StatusPill status={row.status} /></td>
                  <td>
                    <Can permission={`${perm}.manage`} fallback={<span style={{ color: "var(--trackify-text-muted)", fontSize: 12 }}>—</span>}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} title="Edit" onClick={() => setModal({ mode: "edit", row })}>
                          <Edit3 size={13} />
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

      {modal && (
        <Modal title={modal.mode === "create" ? `New ${title.replace(/s$/, "")}` : `Edit ${title.replace(/s$/, "")}`} onClose={() => setModal(null)} width={540}>
          <form onSubmit={handleSave}>
            {(() => {
              const out = [];
              for (let i = 0; i < fields.length; i++) {
                const f = fields[i];
                const next = fields[i + 1];
                if (f.half && next?.half) {
                  out.push(
                    <div className="ops-form-row" key={f.name}>
                      {[f, next].map((ff) => (
                        <FieldInput key={ff.name} f={ff} row={modal.row} />
                      ))}
                    </div>
                  );
                  i++;
                } else {
                  out.push(<FieldInput key={f.name} f={f} row={modal.row} />);
                }
              }
              return out;
            })()}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button type="button" className="ops-back-btn" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="ops-btn ops-btn-primary" disabled={saving} style={{ borderRadius: 10 }}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </PageShell>
  );
}

function FieldInput({ f, row }) {
  const dv = row ? (f.get ? f.get(row) : row[f.name]) : "";
  const defaultValue = dv === null || dv === undefined ? "" : dv;
  return (
    <Field label={f.label}>
      {f.options ? (
        <select className="ops-form-input" name={f.name} defaultValue={defaultValue || f.options[0].value} required={f.required}>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : f.type === "textarea" ? (
        <textarea className="ops-form-input ops-form-textarea" name={f.name} defaultValue={defaultValue} required={f.required} />
      ) : (
        <input
          className="ops-form-input"
          type={f.type === "number" ? "number" : f.type === "email" ? "email" : "text"}
          step={f.type === "number" ? "any" : undefined}
          name={f.name}
          defaultValue={defaultValue}
          required={f.required}
        />
      )}
    </Field>
  );
}

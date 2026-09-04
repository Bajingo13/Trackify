import { Plus, X } from "lucide-react";
import { peso } from "../../services/finance/financeService";

/**
 * Editable list of {description, ...numericCols} line items.
 * cols: [{ key, label, width, type:'number'|'text', compute? }]
 * value/onChange: array of line objects.
 */
export default function LineItems({ cols, value, onChange, addLabel = "Add line" }) {
  const rows = value.length ? value : [blank(cols)];

  const set = (i, key, v) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r));
    onChange(next.map((r) => recompute(r, cols)));
  };
  const add = () => onChange([...rows, blank(cols)]);
  const remove = (i) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r-sm)", overflow: "hidden" }}>
      <table className="ops-table" style={{ margin: 0 }}>
        <thead>
          <tr>
            {cols.map((c) => <th key={c.key} style={{ width: c.width }}>{c.label}</th>)}
            <th style={{ width: 36 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.key}>
                  {c.options ? (
                    <select className="ops-form-input" style={{ minWidth: 120 }} value={r[c.key] ?? ""} onChange={(e) => set(i, c.key, e.target.value)}>
                      <option value="">—</option>
                      {c.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : c.compute ? (
                    <span className="tk-mono">{peso(r[c.key])}</span>
                  ) : (
                    <input
                      className="ops-form-input"
                      type={c.type === "number" ? "number" : "text"}
                      step={c.type === "number" ? "any" : undefined}
                      value={r[c.key] ?? ""}
                      onChange={(e) => set(i, c.key, e.target.value)}
                    />
                  )}
                </td>
              ))}
              <td>
                {rows.length > 1 && (
                  <button type="button" className="ops-btn ops-btn-ghost" style={{ padding: 4 }} onClick={() => remove(i)}><X size={13} /></button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="ops-btn ops-btn-ghost" style={{ margin: 8, fontSize: 12 }} onClick={add}>
        <Plus size={13} /> {addLabel}
      </button>
    </div>
  );
}

function blank(cols) {
  const o = {};
  cols.forEach((c) => { o[c.key] = ""; });
  return o;
}
function recompute(row, cols) {
  const out = { ...row };
  cols.forEach((c) => { if (c.compute) out[c.key] = c.compute(out); });
  return out;
}

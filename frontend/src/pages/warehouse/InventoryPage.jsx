import { useState, useEffect } from "react";
import AppShell from "../../components/layout/AppShell";
import { Search, Package, ArrowRightLeft, X, Plus, Edit3 } from "lucide-react";
import Pagination from "../../components/shared/Pagination";
import { useToast } from "../../components/shared/Toast";
import { getAllInventory, createStockMovement, getInventoryStats, getAllLocations, createItem, updateItem } from "../../services/warehouse/inventoryService";
import { Can } from "../../auth/permissions";
import "../../styles/operations.css";

const CATEGORY_COLORS = { "Consumables": { bg: "#EEF4FF", text: "#2455D6" }, "Spare Parts": { bg: "#DCFCE7", text: "#15803D" }, "Tires": { bg: "#FEF3C7", text: "#92400E" }, "Tools": { bg: "#F3E8FF", text: "#7C3AED" } };
const CATEGORIES = ["Consumables", "Spare Parts", "Tires", "Tools"];
const UNITS = ["Pieces", "Bottles", "Sets", "Units", "Pairs", "Gallons", "Tubes", "Litres", "Boxes"];

function ItemForm({ item, locations, onClose, onSaved }) {
  const { addToast } = useToast();
  const isEdit = !!item;
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState(isEdit
    ? { name: item.name, category: item.category, unit: item.unit, unitCost: item.unitCost, reorderLevel: item.reorderLevel }
    : { sku: "", name: "", category: "Consumables", unit: "Pieces", unitCost: "", reorderLevel: "", initialLocationType: "warehouse", initialLocationId: "", initialQuantity: "" });
  const on = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const iStyle = { padding: "8px 12px", border: "1px solid var(--trackify-border)", borderRadius: 8, fontSize: 13, width: "100%", background: "#F8FAFD" };
  const lStyle = { fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 4, display: "block" };
  const dests = locations.filter((l) => l.locationType === f.initialLocationType);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (isEdit) {
        await updateItem(item.id, { name: f.name, category: f.category, unit: f.unit, unitCost: Number(f.unitCost) || 0, reorderLevel: Number(f.reorderLevel) || 0 });
        addToast("Item updated");
      } else {
        await createItem({
          sku: f.sku, name: f.name, category: f.category, unit: f.unit,
          unitCost: Number(f.unitCost) || 0, reorderLevel: Number(f.reorderLevel) || 0,
          initialLocationType: f.initialLocationId ? f.initialLocationType : undefined,
          initialLocationId: f.initialLocationId ? Number(f.initialLocationId) : undefined,
          initialQuantity: f.initialQuantity ? Number(f.initialQuantity) : undefined,
        });
        addToast("Item created");
      }
      onSaved();
      onClose();
    } catch (err) {
      addToast(err.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ops-modal-overlay" onClick={onClose}>
      <div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="ops-modal-header"><h3 className="ops-modal-title">{isEdit ? `Edit ${item.itemId}` : "Add Inventory Item"}</h3><button className="ops-btn ops-btn-ghost" onClick={onClose}><X size={18} /></button></div>
        <form onSubmit={submit}>
          <div className="ops-modal-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {!isEdit && <div><label style={lStyle}>SKU *</label><input style={iStyle} value={f.sku} onChange={on("sku")} required placeholder="e.g. ITEM-011" /></div>}
            <div style={{ gridColumn: isEdit ? "span 2" : "auto" }}><label style={lStyle}>Name *</label><input style={iStyle} value={f.name} onChange={on("name")} required /></div>
            <div><label style={lStyle}>Category</label><select style={iStyle} value={f.category} onChange={on("category")}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label style={lStyle}>Unit</label><select style={iStyle} value={f.unit} onChange={on("unit")}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></div>
            <div><label style={lStyle}>Unit Cost (₱)</label><input style={iStyle} type="number" min="0" value={f.unitCost} onChange={on("unitCost")} /></div>
            <div><label style={lStyle}>Reorder Level</label><input style={iStyle} type="number" min="0" value={f.reorderLevel} onChange={on("reorderLevel")} /></div>
            {!isEdit && (
              <>
                <div style={{ gridColumn: "span 2", borderTop: "1px solid var(--trackify-border-soft)", paddingTop: 10, marginTop: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--trackify-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Opening stock (optional)</span>
                </div>
                <div><label style={lStyle}>Location type</label><select style={iStyle} value={f.initialLocationType} onChange={(e) => setF((p) => ({ ...p, initialLocationType: e.target.value, initialLocationId: "" }))}><option value="warehouse">Warehouse</option><option value="branch">Branch</option></select></div>
                <div><label style={lStyle}>Location</label><select style={iStyle} value={f.initialLocationId} onChange={on("initialLocationId")}><option value="">— none —</option>{dests.map((l) => <option key={`${l.locationType}-${l.id}`} value={l.id}>{l.name}</option>)}</select></div>
                <div><label style={lStyle}>Quantity</label><input style={iStyle} type="number" min="0" value={f.initialQuantity} onChange={on("initialQuantity")} disabled={!f.initialLocationId} /></div>
              </>
            )}
          </div>
          <div className="ops-modal-footer">
            <button type="button" className="ops-btn ops-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="ops-btn ops-btn-primary" disabled={saving}>{saving ? "Saving…" : isEdit ? "Save changes" : "Add item"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StockMovementForm({ item, locations, saving, onSave, onCancel }) {
  const [form, setForm] = useState({ movementType: "Transfer", quantity: 1, sourceLocationType: item.locationType, sourceLocationId: item.locationId, destinationLocationType: item.locationType === "warehouse" ? "branch" : "warehouse", destinationLocationId: "", reason: "" });
  const handleChange = (field) => (e) => {
    const val = e.target.type === "number" ? Number(e.target.value) : e.target.value;
    setForm((p) => ({ ...p, [field]: val }));
  };
  const needsDest = ["Transfer", "Receiving", "Adjustment"].includes(form.movementType);
  const handleSubmit = (e) => { e.preventDefault(); onSave({ ...form, itemId: item.itemId, itemName: item.name, quantity: Number(form.quantity) }); };

  const inputStyle = { padding: "8px 12px", border: "1px solid var(--trackify-border)", borderRadius: 8, fontSize: 13, width: "100%", background: "#F8FAFD" };
  const labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--trackify-text-secondary)", marginBottom: 4, display: "block" };
  const destLocations = locations.filter((l) => l.locationType === form.destinationLocationType);

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div><label style={labelStyle}>Movement Type *</label><select style={inputStyle} value={form.movementType} onChange={handleChange("movementType")}>{["Transfer", "Issue", "Receiving", "Adjustment", "Return"].map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
        <div><label style={labelStyle}>Quantity *</label><input style={inputStyle} type="number" value={form.quantity} onChange={handleChange("quantity")} min="1" max={item.quantity} required /></div>
        <div><label style={labelStyle}>Source Location</label><input style={inputStyle} value={`${item.locationType === "warehouse" ? "Warehouse" : "Branch"} — ${item.locationName || locations.find((l) => l.locationType === item.locationType && l.id === item.locationId)?.name || "—"}`} disabled /></div>
        {needsDest && <div><label style={labelStyle}>Destination Type *</label><select style={inputStyle} value={form.destinationLocationType} onChange={handleChange("destinationLocationType")}><option value="warehouse">Warehouse</option><option value="branch">Branch</option></select></div>}
        {needsDest && <div><label style={labelStyle}>Destination Location *</label><select style={inputStyle} value={form.destinationLocationId} onChange={handleChange("destinationLocationId")} required><option value="">Select location</option>{destLocations.map((l) => <option key={`${l.locationType}-${l.id}`} value={l.id}>{l.name}</option>)}</select></div>}
        <div style={{ gridColumn: needsDest ? "auto" : "span 2" }}><label style={labelStyle}>Reason{form.movementType === "Adjustment" ? " *" : ""}</label><input style={inputStyle} value={form.reason} onChange={handleChange("reason")} required={form.movementType === "Adjustment"} placeholder={form.movementType === "Issue" ? "e.g. issued to Job #124" : "Optional reason"} /></div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20, borderTop: "1px solid var(--trackify-border-soft)", paddingTop: 16 }}>
        <button type="button" onClick={onCancel} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--trackify-border)", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
        <button type="submit" disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "linear-gradient(90deg, #2455D6, #102F8A)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "Recording…" : "Create Movement"}</button>
      </div>
    </form>
  );
}

export default function InventoryPage() {
  const [data, setData] = useState({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
  const [stats, setStats] = useState({ total: 0, totalValue: 0, lowStock: 0, outOfStock: 0 });
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [locFilter, setLocFilter] = useState("");
  const [attention, setAttention] = useState(""); // "" | "low" | "out"
  const [page, setPage] = useState(1);
  const [movementItem, setMovementItem] = useState(null);
  const [itemForm, setItemForm] = useState(undefined); // undefined = closed, null = create, obj = edit
  const [locations, setLocations] = useState([]);
  const [saving, setSaving] = useState(false);
  const { addToast } = useToast();

  useEffect(() => { getAllLocations().then(setLocations).catch(() => setLocations([])); }, []);

  const loadData = async () => {
    try {
      const [inv, s] = await Promise.all([
        getAllInventory({ search, category: categoryFilter, locationType: locFilter, attention, page, limit: 10 }),
        getInventoryStats(),
      ]);
      setData(inv);
      setStats(s);
    } catch (e) {
      addToast(e.message || "Failed to load inventory", "error");
    }
  };
  useEffect(() => { loadData(); }, [search, categoryFilter, locFilter, attention, page]);

  const handleMovement = async (form) => {
    setSaving(true);
    try {
      const res = await createStockMovement(form);
      addToast(res?.message || "Stock movement recorded");
      setMovementItem(null);
      loadData();
    } catch (e) {
      addToast(e.message || "Movement failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = { padding: "8px 12px", border: "1px solid var(--trackify-border)", borderRadius: 8, fontSize: 13, background: "#F8FAFD" };

  return (
    <AppShell>
      <div className="ops-container">
        <div className="ops-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div className="ops-header-left"><h1 className="ops-title">Inventory Management</h1><p className="ops-subtitle">Track stock levels across warehouses and branches</p></div>
          <Can permission="inventory.manage">
            <button className="ops-btn ops-btn-primary" onClick={() => setItemForm(null)}><Plus size={15} /> Add Item</button>
          </Can>
        </div>
        <div className="ops-stats-bar">
          {[
            { label: "Total Items", count: stats.total, color: "#071A4A", key: "" },
            { label: "Total Value", count: `₱${stats.totalValue.toLocaleString()}`, color: "#22C55E", key: "" },
            { label: "Low Stock", count: stats.lowStock, color: "#F59E0B", key: "low" },
            { label: "Out of Stock", count: stats.outOfStock, color: "#EF4444", key: "out" },
          ].map((s) => {
            const clickable = s.key !== "";
            const active = clickable && attention === s.key;
            return (
              <div
                key={s.label}
                className="ops-stat-pill"
                onClick={clickable ? () => { setAttention(active ? "" : s.key); setPage(1); } : undefined}
                style={clickable ? { cursor: "pointer", outline: active ? `2px solid ${s.color}` : "none", outlineOffset: 1 } : undefined}
                title={clickable ? (active ? "Show all items" : `Show only ${s.label.toLowerCase()}`) : undefined}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: s.color }} />{s.label}</span>
                <span className="ops-stat-count">{s.count}</span>
              </div>
            );
          })}
        </div>
        <div className="ops-card">
          <div className="ops-card-header" style={{ justifyContent: "space-between" }}>
            <div className="ops-search"><Search size={14} style={{ color: "var(--trackify-text-muted)", flexShrink: 0 }} /><input type="text" placeholder="Search inventory..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, minWidth: 130 }}>
                <option value="">All Categories</option>
                {["Consumables", "Spare Parts", "Tires", "Tools"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={locFilter} onChange={(e) => { setLocFilter(e.target.value); setPage(1); }} style={{ ...inputStyle, minWidth: 130 }}>
                <option value="">All Locations</option>
                <option value="warehouse">Warehouses</option>
                <option value="branch">Branches</option>
              </select>
            </div>
          </div>
          <div className="ops-table-wrapper">
            <table className="ops-table">
              <thead><tr><th>Item</th><th>Category</th><th>Location</th><th>Qty</th><th>Unit</th><th>Unit Cost</th><th>Status</th><th style={{ width: 80 }}>Actions</th></tr></thead>
              <tbody>
                {data.data.length === 0 ? (
                  <tr><td colSpan={8}><div className="ops-empty"><Package size={32} style={{ opacity: 0.3 }} /><div className="ops-empty-title">No inventory items</div><div className="ops-empty-desc">{search || categoryFilter || locFilter || attention ? (attention ? "Nothing needs attention — stock is above reorder levels" : "Try adjusting your filters") : "No inventory recorded"}</div></div></td></tr>
                ) : data.data.map((item) => {
                  const catColor = CATEGORY_COLORS[item.category] || CATEGORY_COLORS["Consumables"];
                  return (
                    <tr key={item.id}>
                      <td><div style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</div><div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>{item.itemId}</div></td>
                      <td><span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: catColor.bg, color: catColor.text }}>{item.category}</span></td>
                      <td style={{ fontSize: 13 }}>{item.locationName || "—"}</td>
                      <td style={{ fontSize: 13, fontWeight: 600, color: item.quantity <= item.reorderLevel ? "#EF4444" : "var(--trackify-text)" }}>{item.quantity}</td>
                      <td style={{ fontSize: 13 }}>{item.unit}</td>
                      <td style={{ fontSize: 13 }}>₱{item.unitCost.toLocaleString()}</td>
                      <td><span style={{ padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: item.status === "Low Stock" ? "#FEF3C7" : item.quantity === 0 ? "#FEF2F2" : "#DCFCE7", color: item.status === "Low Stock" ? "#92400E" : item.quantity === 0 ? "#B91C1C" : "#15803D" }}>{item.status}</span></td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <Can permission="inventory.manage">
                            <button className="ops-btn ops-btn-ghost" style={{ padding: "4px 8px" }} title="Edit item" onClick={() => setItemForm(item)}><Edit3 size={12} /></button>
                          </Can>
                          <Can permission="stockmovement.manage" fallback={<span style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>—</span>}>
                            <button className="ops-btn ops-btn-primary" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => setMovementItem(item)}><ArrowRightLeft size={12} /> Move</button>
                          </Can>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} total={data.total} perPage={data.limit} onPageChange={setPage} />
        </div>

        {itemForm !== undefined && (
          <ItemForm item={itemForm} locations={locations} onClose={() => setItemForm(undefined)} onSaved={loadData} />
        )}

        {movementItem && (
          <div className="ops-modal-overlay" onClick={() => setMovementItem(null)}>
            <div className="ops-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
              <div className="ops-modal-header"><h3 className="ops-modal-title">Stock Movement — {movementItem.name}</h3><button className="ops-btn ops-btn-ghost" onClick={() => setMovementItem(null)}><X size={18} /></button></div>
              <div className="ops-modal-body">
                <div style={{ marginBottom: 16, padding: "12px 16px", background: "#F8FAFD", borderRadius: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <div><div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>Current Stock</div><div style={{ fontSize: 16, fontWeight: 700 }}>{movementItem.quantity} {movementItem.unit}</div></div>
                  <div><div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>Reorder Level</div><div style={{ fontSize: 16, fontWeight: 700 }}>{movementItem.reorderLevel} {movementItem.unit}</div></div>
                  <div><div style={{ fontSize: 11, color: "var(--trackify-text-muted)" }}>Value</div><div style={{ fontSize: 16, fontWeight: 700 }}>₱{(movementItem.quantity * movementItem.unitCost).toLocaleString()}</div></div>
                </div>
                <StockMovementForm item={movementItem} locations={locations} saving={saving} onSave={handleMovement} onCancel={() => setMovementItem(null)} />
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

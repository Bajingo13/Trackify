import { logAudit } from "../auditService";

let nextId = 100;
let movementId = 1000;

const warehouses = [
  { id: 1, name: "Makati Distribution Center", code: "MK-DC", location: "Makati City", status: "Active" },
  { id: 2, name: "Cebu Warehouse", code: "CB-WH", location: "Cebu City", status: "Active" },
  { id: 3, name: "Davao Warehouse", code: "DV-WH", location: "Davao City", status: "Active" },
  { id: 4, name: "Clark Depot", code: "CL-DP", location: "Clark, Pampanga", status: "Active" },
];

const branches = [
  { id: 1, name: "Makati Branch", code: "MK-BR", location: "Makati City", status: "Active" },
  { id: 2, name: "Cebu Branch", code: "CB-BR", location: "Cebu City", status: "Active" },
  { id: 3, name: "Davao Branch", code: "DV-BR", location: "Davao City", status: "Active" },
  { id: 4, name: "Clark Branch", code: "CL-BR", location: "Clark, Pampanga", status: "Active" },
];

const inventoryItems = [
  { id: 1, itemId: "ITEM-001", name: "Engine Oil 5W-40 (4L)", category: "Consumables", locationType: "warehouse", locationId: 1, quantity: 120, unit: "Bottles", reorderLevel: 30, unitCost: 1800, status: "In Stock", lastUpdated: "2026-02-15" },
  { id: 2, itemId: "ITEM-001", name: "Engine Oil 5W-40 (4L)", category: "Consumables", locationType: "branch", locationId: 1, quantity: 24, unit: "Bottles", reorderLevel: 10, unitCost: 1800, status: "In Stock", lastUpdated: "2026-02-15" },
  { id: 3, itemId: "ITEM-002", name: "Brake Pad Set (Front)", category: "Spare Parts", locationType: "warehouse", locationId: 1, quantity: 45, unit: "Sets", reorderLevel: 10, unitCost: 2800, status: "In Stock", lastUpdated: "2026-02-10" },
  { id: 4, itemId: "ITEM-003", name: "NS40Z Battery", category: "Spare Parts", locationType: "warehouse", locationId: 2, quantity: 18, unit: "Units", reorderLevel: 5, unitCost: 5500, status: "In Stock", lastUpdated: "2026-02-12" },
  { id: 5, itemId: "ITEM-004", name: "Fuel Filter (Diesel)", category: "Consumables", locationType: "warehouse", locationId: 1, quantity: 80, unit: "Pieces", reorderLevel: 20, unitCost: 450, status: "In Stock", lastUpdated: "2026-02-14" },
  { id: 6, itemId: "ITEM-005", name: "Tire 225/70R17.5", category: "Tires", locationType: "warehouse", locationId: 3, quantity: 8, unit: "Pieces", reorderLevel: 4, unitCost: 12000, status: "Low Stock", lastUpdated: "2026-02-08" },
  { id: 7, itemId: "ITEM-006", name: "Windshield Wiper Blade", category: "Consumables", locationType: "branch", locationId: 2, quantity: 15, unit: "Pairs", reorderLevel: 5, unitCost: 350, status: "In Stock", lastUpdated: "2026-02-13" },
  { id: 8, itemId: "ITEM-007", name: "Transmission Fluid ATF", category: "Consumables", locationType: "warehouse", locationId: 4, quantity: 3, unit: "Gallons", reorderLevel: 10, unitCost: 2200, status: "Low Stock", lastUpdated: "2026-02-11" },
  { id: 9, itemId: "ITEM-008", name: "Air Filter Element", category: "Spare Parts", locationType: "warehouse", locationId: 1, quantity: 60, unit: "Pieces", reorderLevel: 15, unitCost: 650, status: "In Stock", lastUpdated: "2026-02-15" },
  { id: 10, itemId: "ITEM-009", name: "Coolant Antifreeze (4L)", category: "Consumables", locationType: "branch", locationId: 3, quantity: 10, unit: "Bottles", reorderLevel: 5, unitCost: 950, status: "In Stock", lastUpdated: "2026-02-09" },
];

const stockMovements = [
  { id: 1, itemId: "ITEM-001", itemName: "Engine Oil 5W-40 (4L)", quantity: 20, sourceLocationType: "warehouse", sourceLocationId: 1, sourceLocationName: "Makati Distribution Center", destinationLocationType: "branch", destinationLocationId: 1, destinationLocationName: "Makati Branch", movementType: "Transfer", date: "2026-02-15", requestedBy: "Super Admin", approvedBy: "Fleet Admin", status: "Completed", referenceNo: "SMT-2026-001" },
  { id: 2, itemId: "ITEM-001", itemName: "Engine Oil 5W-40 (4L)", quantity: 5, sourceLocationType: "warehouse", sourceLocationId: 1, sourceLocationName: "Makati Distribution Center", destinationLocationType: "branch", destinationLocationId: 2, destinationLocationName: "Cebu Branch", movementType: "Transfer", date: "2026-02-14", requestedBy: "Super Admin", approvedBy: "Fleet Admin", status: "In Transit", referenceNo: "SMT-2026-002" },
  { id: 3, itemId: "ITEM-003", itemName: "NS40Z Battery", quantity: 2, sourceLocationType: "warehouse", sourceLocationId: 2, sourceLocationName: "Cebu Warehouse", destinationLocationType: "branch", destinationLocationId: 3, destinationLocationName: "Davao Branch", movementType: "Issue", date: "2026-02-13", requestedBy: "Super Admin", approvedBy: "Fleet Admin", status: "Completed", referenceNo: "SMT-2026-003" },
  { id: 4, itemId: "ITEM-005", itemName: "Tire 225/70R17.5", quantity: 4, sourceLocationType: "warehouse", sourceLocationId: 3, sourceLocationName: "Davao Warehouse", destinationLocationType: "branch", destinationLocationId: 3, destinationLocationName: "Davao Branch", movementType: "Receiving", date: "2026-02-12", requestedBy: "Branch Manager", approvedBy: "Fleet Admin", status: "Completed", referenceNo: "SMT-2026-004" },
  { id: 5, itemId: "ITEM-007", itemName: "Transmission Fluid ATF", quantity: 7, sourceLocationType: "warehouse", sourceLocationId: 4, sourceLocationName: "Clark Depot", destinationLocationType: "branch", destinationLocationId: 1, destinationLocationName: "Makati Branch", movementType: "Adjustment", date: "2026-02-11", requestedBy: "Super Admin", approvedBy: "Fleet Admin", status: "Completed", referenceNo: "SMT-2026-005", reason: "Stock correction after physical count" },
];

export function getAllLocations() {
  return [...warehouses.map((w) => ({ ...w, locationType: "warehouse" })), ...branches.map((b) => ({ ...b, locationType: "branch" }))];
}

export function getAllInventory(filters = {}) {
  let result = [...inventoryItems];
  if (filters.category) result = result.filter((i) => i.category === filters.category);
  if (filters.locationType) result = result.filter((i) => i.locationType === filters.locationType);
  if (filters.locationId) result = result.filter((i) => i.locationId === filters.locationId);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (i) =>
        i.itemId.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q)
    );
  }
  if (filters.sort) {
    const [key, dir] = filters.sort.split(":");
    result.sort((a, b) => {
      const va = a[key] ?? "";
      const vb = b[key] ?? "";
      const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
      return dir === "desc" ? -cmp : cmp;
    });
  }
  const page = filters.page || 1;
  const limit = filters.limit || 10;
  const total = result.length;
  const paginated = result.slice((page - 1) * limit, page * limit);
  return { data: paginated, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export function createStockMovement(data) {
  const movement = {
    id: movementId++,
    ...data,
    date: data.date || new Date().toISOString().split("T")[0],
    requestedBy: data.requestedBy || "Super Admin",
    approvedBy: data.approvedBy || "Fleet Admin",
    status: data.status || "Pending",
    referenceNo: data.referenceNo || `SMT-${new Date().getFullYear()}-${String(movementId).padStart(3, "0")}`,
  };
  stockMovements.unshift(movement);

  const sourceItem = inventoryItems.find(
    (i) => i.itemId === data.itemId && i.locationType === data.sourceLocationType && i.locationId === data.sourceLocationId
  );
  if (sourceItem && (data.movementType === "Transfer" || data.movementType === "Issue" || data.movementType === "Return")) {
    sourceItem.quantity = Math.max(0, sourceItem.quantity - data.quantity);
    sourceItem.status = sourceItem.quantity <= sourceItem.reorderLevel ? "Low Stock" : "In Stock";
    sourceItem.lastUpdated = movement.date;
  }

  if (data.destinationLocationType && data.destinationLocationId) {
    const destItem = inventoryItems.find(
      (i) => i.itemId === data.itemId && i.locationType === data.destinationLocationType && i.locationId === data.destinationLocationId
    );
    if (destItem) {
      destItem.quantity += data.quantity;
      destItem.status = destItem.quantity <= destItem.reorderLevel ? "Low Stock" : "In Stock";
      destItem.lastUpdated = movement.date;
    } else {
      const template = inventoryItems.find((i) => i.itemId === data.itemId);
      if (template) {
        inventoryItems.push({
          id: nextId++,
          itemId: data.itemId,
          name: data.itemName || template.name,
          category: template.category,
          locationType: data.destinationLocationType,
          locationId: data.destinationLocationId,
          quantity: data.quantity,
          unit: template.unit,
          reorderLevel: template.reorderLevel,
          unitCost: template.unitCost,
          status: "In Stock",
          lastUpdated: movement.date,
        });
      }
    }
  }

  logAudit({ module: "Warehouse", action: `Stock ${data.movementType}`, referenceId: movement.id, newValue: movement, reason: data.reason });
  return movement;
}

export function getAllStockMovements(filters = {}) {
  let result = [...stockMovements];
  if (filters.movementType) result = result.filter((m) => m.movementType === filters.movementType);
  if (filters.status) result = result.filter((m) => m.status === filters.status);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (m) =>
        m.referenceNo.toLowerCase().includes(q) ||
        m.itemName.toLowerCase().includes(q) ||
        m.sourceLocationName.toLowerCase().includes(q) ||
        m.destinationLocationName.toLowerCase().includes(q)
    );
  }
  return result;
}

export function getStockMovementStats() {
  const total = stockMovements.length;
  const completed = stockMovements.filter((m) => m.status === "Completed").length;
  const inTransit = stockMovements.filter((m) => m.status === "In Transit").length;
  const pending = stockMovements.filter((m) => m.status === "Pending").length;
  return { total, completed, inTransit, pending };
}

export function getInventoryStats() {
  const total = inventoryItems.length;
  const totalValue = inventoryItems.reduce((sum, i) => sum + i.quantity * i.unitCost, 0);
  const lowStock = inventoryItems.filter((i) => i.status === "Low Stock").length;
  const outOfStock = inventoryItems.filter((i) => i.quantity === 0).length;
  return { total, totalValue, lowStock, outOfStock };
}

export { warehouses, branches };

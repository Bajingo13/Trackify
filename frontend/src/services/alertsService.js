import { getLowStock } from "./warehouse/inventoryService";
import { getAllExceptions } from "./operations/exceptionService";

/**
 * The things that need someone's attention right now, from every source the
 * signed-in user is allowed to read. Shared by the dashboard's Operational
 * Alerts panel and the top-bar notification bell so they never disagree.
 *
 * Each source is settled independently — a role without inventory access still
 * sees its exceptions, and vice versa.
 */
export async function loadAlerts() {
  const out = [];
  const [low, exc] = await Promise.allSettled([getLowStock(), getAllExceptions()]);

  if (low.status === "fulfilled") {
    for (const s of low.value) {
      out.push({
        id: `low-${s.stockId}`,
        kind: "inventory",
        severity: s.severity, // "critical" | "warning"
        title: s.quantity <= 0 ? `${s.name} out of stock` : `${s.name} low`,
        description: `${s.locationName} — ${s.quantity} ${s.unit || ""} on hand (reorder at ${s.reorderLevel})`,
        tag: "Inventory",
        href: "/warehouse/inventory",
      });
    }
  }

  if (exc.status === "fulfilled") {
    const open = exc.value.filter((e) => e.status && e.status !== "resolved").slice(0, 10);
    for (const e of open) {
      out.push({
        id: `exc-${e.id}`,
        kind: "exception",
        severity: ["high", "critical"].includes(e.severity) ? "critical" : "warning",
        title: e.title || e.type || "Operational exception",
        description: [e.tripTicket, e.description].filter(Boolean).join(" — "),
        tag: "Operations",
        href: "/operations/exceptions",
      });
    }
  }

  const rank = { critical: 0, warning: 1, info: 2 };
  out.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
  return out;
}

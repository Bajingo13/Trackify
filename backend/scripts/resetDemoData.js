/**
 * Restore the demo database to a clean baseline after QA / manual testing.
 *
 *   npm run db:reset-demo
 *
 * Removes rows the QA scripts and manual testing create (extra trips, branch
 * transfers, stock movements, vouchers, invoices, journal entries, maintenance,
 * "E2E Customer ZZ" and any QA vehicle), frees seed trips that were left
 * assigned, and restores inventory_stock to the migration-007 seed quantities.
 *
 * It NEVER drops tables and only touches company 1. Adjust KEEP_TRIP_MAX if the
 * client has created real trips you want to preserve.
 */
import "../src/config/env.js";
import db from "../src/config/db.js";
import { refuseProductionDatabase } from "../src/shared/productionDatabaseGuard.js";

// Deletes trips, vouchers, invoices and journal entries. Against production
// that is destroying real records, so it stops before connecting.
refuseProductionDatabase("db:reset-demo");

const KEEP_TRIP_MAX = 60; // trip_ticket_id <= this is treated as baseline

// migration 007 seed stock: [SKU, locationType, locationCode, qty]
const SEED_STOCK = [
  ["ITEM-001", "warehouse", "DVO-WH", 120], ["ITEM-001", "branch", "DVO", 24],
  ["ITEM-002", "warehouse", "DVO-WH", 45], ["ITEM-003", "warehouse", "CEB-WH", 18],
  ["ITEM-004", "warehouse", "DVO-WH", 80], ["ITEM-005", "warehouse", "GEN-WH", 8],
  ["ITEM-006", "branch", "CEB", 15], ["ITEM-007", "warehouse", "GEN-WH", 3],
  ["ITEM-008", "warehouse", "DVO-WH", 60], ["ITEM-009", "branch", "GEN", 10],
  ["ITEM-010", "warehouse", "CEB-WH", 40],
];

const q = (sql, args = []) => db.query(sql, args);
async function run(label, sql, args = []) {
  const [r] = await q(sql, args);
  if (r.affectedRows) console.log(`  ${label}: ${r.affectedRows}`);
  return r;
}

async function main() {
  console.log("[reset] company 1 — restoring demo baseline\n");

  // ---- extra trips + their children -------------------------------------
  const [trips] = await q("SELECT trip_ticket_id id FROM trip_tickets WHERE company_id = 1 AND trip_ticket_id > ?", [KEEP_TRIP_MAX]);
  console.log(`trips to remove (id > ${KEEP_TRIP_MAX}): ${trips.length}`);
  for (const { id } of trips) {
    for (const t of ["trip_expenses", "approval_actions", "cargo_events", "trip_status_history",
      "trip_assignments", "trip_tracking_points", "trip_stops", "operational_exceptions"]) {
      await q(`DELETE FROM ${t} WHERE trip_ticket_id = ?`, [id]).catch(() => {});
    }
    await q("DELETE FROM trip_tickets WHERE trip_ticket_id = ?", [id]);
  }

  // ---- free seed trips left assigned by QA ------------------------------
  const [stuck] = await q(
    `SELECT DISTINCT tt.trip_ticket_id id, tt.status
       FROM trip_tickets tt
       JOIN trip_assignments ta ON ta.trip_ticket_id = tt.trip_ticket_id AND ta.is_current = TRUE
      WHERE tt.company_id = 1 AND tt.trip_ticket_id <= ?
        AND tt.status IN ('assigned','accepted')`,
    [KEEP_TRIP_MAX]
  );
  if (stuck.length) {
    console.log(`freeing ${stuck.length} seed trip(s) stuck at assigned/accepted`);
    for (const { id } of stuck) {
      await q("DELETE FROM trip_assignments WHERE trip_ticket_id = ?", [id]);
      await q("DELETE FROM trip_status_history WHERE trip_ticket_id = ? AND to_status IN ('assigned','accepted')", [id]);
      await q("UPDATE trip_tickets SET status = 'approved' WHERE trip_ticket_id = ?", [id]);
    }
  }

  // ---- warehouse: transfers, movements --------------------------------
  console.log("warehouse");
  await run("branch_transfer_items", "DELETE FROM branch_transfer_items WHERE transfer_id > 3");
  await run("branch_transfers", "DELETE FROM branch_transfers WHERE company_id = 1 AND transfer_id > 3");
  await run("stock_movements", "DELETE FROM stock_movements WHERE company_id = 1 AND movement_id > 5");

  // restore seed stock (delete company-1 rows, re-insert seed)
  await q("DELETE FROM inventory_stock WHERE company_id = 1");
  const [items] = await q("SELECT item_id, sku FROM inventory_items WHERE company_id = 1");
  const [whs] = await q("SELECT warehouse_id, code FROM warehouses WHERE company_id = 1");
  const [brs] = await q("SELECT branch_id, branch_code FROM branches WHERE company_id = 1");
  const iid = Object.fromEntries(items.map((r) => [r.sku, r.item_id]));
  const wid = Object.fromEntries(whs.map((r) => [r.code, r.warehouse_id]));
  const bid = Object.fromEntries(brs.map((r) => [r.branch_code, r.branch_id]));
  let stockRows = 0;
  for (const [sku, lt, code, qty] of SEED_STOCK) {
    const lid = lt === "warehouse" ? wid[code] : bid[code];
    if (!iid[sku] || !lid) continue;
    await q(
      "INSERT INTO inventory_stock (company_id, item_id, location_type, location_id, quantity) VALUES (1, ?, ?, ?, ?)",
      [iid[sku], lt, lid, qty]
    );
    stockRows++;
  }
  console.log(`  inventory_stock: restored ${stockRows} seed rows`);
  await run("inventory_items (QA)", "DELETE FROM inventory_items WHERE company_id = 1 AND (sku LIKE 'QA-%' OR sku LIKE 'QA%X')");

  // ---- finance: vouchers, invoices, journal entries -----------------
  console.log("finance");
  await run("expense_voucher_lines", "DELETE FROM expense_voucher_lines WHERE voucher_id > 1");
  await run("trip_expenses (vouchered)", "DELETE FROM trip_expenses WHERE voucher_id > 1");
  await run("expense_vouchers", "DELETE FROM expense_vouchers WHERE company_id = 1 AND voucher_id > 1");
  await run("invoice_lines", "DELETE FROM invoice_lines WHERE invoice_id > 1");
  await run("invoices", "DELETE FROM invoices WHERE company_id = 1 AND invoice_id > 1");
  await run("journal_lines", "DELETE FROM journal_lines WHERE entry_id > 1");
  await run("journal_entries", "DELETE FROM journal_entries WHERE company_id = 1 AND entry_id > 1");

  // ---- fleet: QA maintenance + QA vehicles -------------------------
  console.log("fleet");
  await run("vehicle_maintenance", "DELETE FROM vehicle_maintenance WHERE company_id = 1 AND maintenance_id > 22");
  const [qv] = await q("SELECT vehicle_id FROM vehicles WHERE company_id = 1 AND plate_no LIKE 'TRK-QA%'");
  for (const { vehicle_id } of qv) {
    await q("DELETE FROM trip_assignments WHERE vehicle_id = ?", [vehicle_id]);
    await q("DELETE FROM audit_logs WHERE entity_type = 'vehicle' AND entity_id = ?", [vehicle_id]).catch(() => {});
    await q("DELETE FROM vehicles WHERE vehicle_id = ?", [vehicle_id]);
  }
  if (qv.length) console.log(`  vehicles (TRK-QA): ${qv.length}`);

  // ---- master data: E2E customers ---------------------------------
  const [ec] = await q("SELECT customer_id FROM customers WHERE company_id = 1 AND customer_name LIKE 'E2E%'");
  for (const { customer_id } of ec) {
    const [inv] = await q("SELECT invoice_id FROM invoices WHERE customer_id = ?", [customer_id]);
    for (const { invoice_id } of inv) {
      await q("DELETE FROM invoice_lines WHERE invoice_id = ?", [invoice_id]);
      await q("DELETE FROM invoices WHERE invoice_id = ?", [invoice_id]);
    }
    await q("DELETE FROM customers WHERE customer_id = ?", [customer_id]).catch(() => {});
  }
  if (ec.length) console.log(`\ncustomers (E2E): ${ec.length}`);

  // ---- summary ----------------------------------------------------
  const c = async (t) => (await q(`SELECT COUNT(*) n FROM ${t}`))[0][0].n;
  console.log("\n[reset] baseline now:");
  console.log(`  trips ${await c("trip_tickets")} · customers ${await c("customers")} · vehicles ${await c("vehicles")}`);
  console.log(`  transfers ${await c("branch_transfers")} · movements ${await c("stock_movements")} · maintenance ${await c("vehicle_maintenance")}`);
  console.log(`  vouchers ${await c("expense_vouchers")} · invoices ${await c("invoices")} · journal entries ${await c("journal_entries")}`);

  await db.end();
}

main().catch((e) => { console.error(`[reset] ${e.message}`); process.exit(1); });

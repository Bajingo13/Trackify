import "../src/config/env.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import appDb from "../src/config/db.js";
import { getCustomer, listCustomers } from "../src/modules/master-data/customers.controller.js";
import { getVehicle, listVehicles } from "../src/modules/fleet/vehicles.controller.js";
import { getInvoice, listInvoices } from "../src/modules/finance/invoices.controller.js";
import { getTrip, listTrips } from "../src/modules/operations/trips.controller.js";
import { activeTrips, trackingHistory } from "../src/modules/operations/tracking.controller.js";

let db;
let records;

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

before(async () => {
  try {
    db = await mysql.createConnection({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "trackify",
    });
  } catch {
    db = null;
    return;
  }

  const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const [companyA] = await db.execute(
    "INSERT INTO companies (company_name, company_code, status) VALUES (?, ?, 'active')",
    [`Isolation A ${tag}`, `IA${tag}`.slice(0, 40)]
  );
  const [companyB] = await db.execute(
    "INSERT INTO companies (company_name, company_code, status) VALUES (?, ?, 'active')",
    [`Isolation B ${tag}`, `IB${tag}`.slice(0, 40)]
  );
  const [branchA] = await db.execute(
    "INSERT INTO branches (company_id, branch_name, branch_code, prefix, status) VALUES (?, 'Main', 'MAIN', 'A', 'active')",
    [companyA.insertId]
  );
  const [branchB] = await db.execute(
    "INSERT INTO branches (company_id, branch_name, branch_code, prefix, status) VALUES (?, 'Main', 'MAIN', 'B', 'active')",
    [companyB.insertId]
  );
  const [userA] = await db.execute(
    "INSERT INTO users (email, password_hash, first_name, last_name, status) VALUES (?, 'not-a-login', 'Isolation', 'A', 'active')",
    [`isolation-a-${tag}@example.test`]
  );
  const [userB] = await db.execute(
    "INSERT INTO users (email, password_hash, first_name, last_name, status) VALUES (?, 'not-a-login', 'Isolation', 'B', 'active')",
    [`isolation-b-${tag}@example.test`]
  );
  const [customerA] = await db.execute(
    "INSERT INTO customers (company_id, customer_code, customer_name, status) VALUES (?, 'CUS-A', ?, 'active')",
    [companyA.insertId, `Only A ${tag}`]
  );
  const [customerB] = await db.execute(
    "INSERT INTO customers (company_id, customer_code, customer_name, status) VALUES (?, 'CUS-B', ?, 'active')",
    [companyB.insertId, `Only B ${tag}`]
  );
  const [vehicleA] = await db.execute(
    "INSERT INTO vehicles (company_id, home_branch_id, plate_no, vehicle_type, status) VALUES (?, ?, ?, 'Wing Van', 'active')",
    [companyA.insertId, branchA.insertId, `A${String(tag).slice(-8)}`]
  );
  const [vehicleB] = await db.execute(
    "INSERT INTO vehicles (company_id, home_branch_id, plate_no, vehicle_type, status) VALUES (?, ?, ?, 'Wing Van', 'active')",
    [companyB.insertId, branchB.insertId, `B${String(tag).slice(-8)}`]
  );
  const [driverA] = await db.execute(
    `INSERT INTO drivers
       (company_id, home_branch_id, first_name, last_name, license_no, license_expiry, status)
     VALUES (?, ?, 'Driver', 'A', ?, '2030-12-31', 'on_trip')`,
    [companyA.insertId, branchA.insertId, `LIC-A-${tag}`]
  );
  const [driverB] = await db.execute(
    `INSERT INTO drivers
       (company_id, home_branch_id, first_name, last_name, license_no, license_expiry, status)
     VALUES (?, ?, 'Driver', 'B', ?, '2030-12-31', 'on_trip')`,
    [companyB.insertId, branchB.insertId, `LIC-B-${tag}`]
  );
  const [invoiceA] = await db.execute(
    `INSERT INTO invoices
       (company_id, branch_id, invoice_no, customer_id, invoice_date, subtotal, tax_amount, total, amount_paid, status)
     VALUES (?, ?, ?, ?, CURRENT_DATE, 100, 0, 100, 0, 'sent')`,
    [companyA.insertId, branchA.insertId, `INV-A-${tag}`.slice(0, 30), customerA.insertId]
  );
  const [invoiceB] = await db.execute(
    `INSERT INTO invoices
       (company_id, branch_id, invoice_no, customer_id, invoice_date, subtotal, tax_amount, total, amount_paid, status)
     VALUES (?, ?, ?, ?, CURRENT_DATE, 200, 0, 200, 0, 'sent')`,
    [companyB.insertId, branchB.insertId, `INV-B-${tag}`.slice(0, 30), customerB.insertId]
  );
  const [tripA] = await db.execute(
    `INSERT INTO trip_tickets
       (company_id, branch_id, ticket_no, customer_id, purpose, origin, destination,
        scheduled_departure, status, created_by)
     VALUES (?, ?, ?, ?, 'Isolation test', 'Origin A', 'Destination A', NOW(), 'released', ?)`,
    [companyA.insertId, branchA.insertId, `TRIP-A-${tag}`.slice(0, 50), customerA.insertId, userA.insertId]
  );
  const [tripB] = await db.execute(
    `INSERT INTO trip_tickets
       (company_id, branch_id, ticket_no, customer_id, purpose, origin, destination,
        scheduled_departure, status, created_by)
     VALUES (?, ?, ?, ?, 'Isolation test', 'Origin B', 'Destination B', NOW(), 'released', ?)`,
    [companyB.insertId, branchB.insertId, `TRIP-B-${tag}`.slice(0, 50), customerB.insertId, userB.insertId]
  );
  await db.execute(
    `INSERT INTO trip_assignments
       (company_id, branch_id, trip_ticket_id, driver_id, vehicle_id, assigned_by, is_current, status)
     VALUES (?, ?, ?, ?, ?, ?, TRUE, 'released'), (?, ?, ?, ?, ?, ?, TRUE, 'released')`,
    [
      companyA.insertId, branchA.insertId, tripA.insertId, driverA.insertId, vehicleA.insertId, userA.insertId,
      companyB.insertId, branchB.insertId, tripB.insertId, driverB.insertId, vehicleB.insertId, userB.insertId,
    ]
  );
  const [trackingA] = await db.execute(
    `INSERT INTO trip_tracking_points
       (company_id, branch_id, trip_ticket_id, driver_id, vehicle_id, latitude, longitude, recorded_at)
     VALUES (?, ?, ?, ?, ?, 7.0707, 125.6087, NOW())`,
    [companyA.insertId, branchA.insertId, tripA.insertId, driverA.insertId, vehicleA.insertId]
  );
  const [trackingB] = await db.execute(
    `INSERT INTO trip_tracking_points
       (company_id, branch_id, trip_ticket_id, driver_id, vehicle_id, latitude, longitude, recorded_at)
     VALUES (?, ?, ?, ?, ?, 14.5995, 120.9842, NOW())`,
    [companyB.insertId, branchB.insertId, tripB.insertId, driverB.insertId, vehicleB.insertId]
  );

  records = {
    companyA: companyA.insertId, companyB: companyB.insertId,
    branchA: branchA.insertId, branchB: branchB.insertId,
    customerA: customerA.insertId, customerB: customerB.insertId,
    vehicleA: vehicleA.insertId, vehicleB: vehicleB.insertId,
    invoiceA: invoiceA.insertId, invoiceB: invoiceB.insertId,
    userA: userA.insertId, userB: userB.insertId,
    driverA: driverA.insertId, driverB: driverB.insertId,
    tripA: tripA.insertId, tripB: tripB.insertId,
    trackingA: trackingA.insertId, trackingB: trackingB.insertId,
  };
});

after(async () => {
  await appDb.end().catch(() => {});
  if (!db || !records) {
    if (db) await db.end();
    return;
  }
  await db.execute("DELETE FROM trip_tracking_points WHERE company_id IN (?, ?)", [records.companyA, records.companyB]);
  await db.execute("DELETE FROM trip_assignments WHERE company_id IN (?, ?)", [records.companyA, records.companyB]);
  await db.execute("DELETE FROM trip_tickets WHERE company_id IN (?, ?)", [records.companyA, records.companyB]);
  await db.execute("DELETE FROM invoices WHERE company_id IN (?, ?)", [records.companyA, records.companyB]);
  await db.execute("DELETE FROM drivers WHERE company_id IN (?, ?)", [records.companyA, records.companyB]);
  await db.execute("DELETE FROM vehicles WHERE company_id IN (?, ?)", [records.companyA, records.companyB]);
  await db.execute("DELETE FROM customers WHERE company_id IN (?, ?)", [records.companyA, records.companyB]);
  await db.execute("DELETE FROM users WHERE user_id IN (?, ?)", [records.userA, records.userB]);
  await db.execute("DELETE FROM branches WHERE company_id IN (?, ?)", [records.companyA, records.companyB]);
  await db.execute("DELETE FROM companies WHERE company_id IN (?, ?)", [records.companyA, records.companyB]);
  await db.end();
});

test("customer, vehicle, and invoice lists never include another company's rows", async (t) => {
  if (!db) return t.skip("no database");
  const context = { companyId: records.companyA, branchId: records.branchA };

  const customers = response();
  await listCustomers({ context, query: {} }, customers);
  assert.deepEqual(customers.body.data.map((row) => row.customer_id), [records.customerA]);

  const vehicles = response();
  await listVehicles({ context, query: {} }, vehicles);
  assert.deepEqual(vehicles.body.data.map((row) => row.vehicle_id), [records.vehicleA]);

  const invoices = response();
  await listInvoices({ context, query: {} }, invoices);
  assert.deepEqual(invoices.body.data.map((row) => row.id), [records.invoiceA]);
});

test("direct record URLs return not found across the company boundary", async (t) => {
  if (!db) return t.skip("no database");
  const context = { companyId: records.companyA, branchId: records.branchA };
  for (const [controller, id] of [
    [getCustomer, records.customerB],
    [getVehicle, records.vehicleB],
    [getInvoice, records.invoiceB],
    [getTrip, records.tripB],
  ]) {
    const res = response();
    await controller({ context, params: { id } }, res);
    assert.equal(res.statusCode, 404);
  }
});

test("trip lists and live tracking never expose another company's movement", async (t) => {
  if (!db) return t.skip("no database");
  const context = { companyId: records.companyA, branchId: records.branchA };

  const trips = response();
  await listTrips({ context, query: {} }, trips);
  assert.deepEqual(trips.body.data.map((row) => row.trip_ticket_id), [records.tripA]);

  const live = response();
  await activeTrips({ context }, live);
  assert.deepEqual(live.body.data.map((row) => row.trip_ticket_id), [records.tripA]);
  assert.equal(Number(live.body.data[0].latitude), 7.0707);

  const crossTenantTrail = response();
  await trackingHistory(
    { context, params: { id: records.tripB } },
    crossTenantTrail
  );
  assert.deepEqual(crossTenantTrail.body.data, []);
});

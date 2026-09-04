/**
 * 015 — Live tracking + km-based maintenance foundation.
 *
 * - trip_tickets: origin/destination coordinates + cached route distance/time
 * - drivers: PIN hash + app-enabled flag (Driver App login)
 * - vehicles: service_interval_km + last_service_odometer (km-interval servicing)
 *
 * Idempotent. Light demo seed for company 1.
 */
import bcrypt from "bcrypt";

async function addColumn(conn, table, column, ddl) {
  const [cols] = await conn.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (!cols.length) await conn.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

export async function up(conn) {
  /* ---- trip coordinates + route cache ---- */
  await addColumn(conn, "trip_tickets", "origin_lat", "origin_lat DECIMAL(10,7) NULL AFTER origin");
  await addColumn(conn, "trip_tickets", "origin_lng", "origin_lng DECIMAL(10,7) NULL AFTER origin_lat");
  await addColumn(conn, "trip_tickets", "destination_lat", "destination_lat DECIMAL(10,7) NULL AFTER destination");
  await addColumn(conn, "trip_tickets", "destination_lng", "destination_lng DECIMAL(10,7) NULL AFTER destination_lat");
  await addColumn(conn, "trip_tickets", "route_distance_km", "route_distance_km DECIMAL(10,2) NULL");
  await addColumn(conn, "trip_tickets", "route_duration_min", "route_duration_min INT UNSIGNED NULL");

  /* ---- driver app login ---- */
  await addColumn(conn, "drivers", "pin_hash", "pin_hash VARCHAR(255) NULL");
  await addColumn(conn, "drivers", "app_enabled", "app_enabled TINYINT(1) NOT NULL DEFAULT 0");

  /* ---- km-interval maintenance ---- */
  await addColumn(conn, "vehicles", "service_interval_km", "service_interval_km INT UNSIGNED NULL");
  await addColumn(conn, "vehicles", "last_service_odometer", "last_service_odometer DECIMAL(12,2) NOT NULL DEFAULT 0");

  /* ---------- demo seed (company 1) ---------- */

  // Davao-area coordinates for a couple of active demo trips
  const davao = [
    { name: "Davao City", lat: 7.0731, lng: 125.6128 },
    { name: "Panabo City", lat: 7.3081, lng: 125.6841 },
    { name: "Tagum City", lat: 7.4478, lng: 125.8078 },
    { name: "Digos City", lat: 6.7496, lng: 125.3572 },
    { name: "General Santos City", lat: 6.1164, lng: 125.1716 },
  ];
  const [trips] = await conn.query(
    `SELECT trip_ticket_id, origin, destination FROM trip_tickets
      WHERE company_id = 1 AND origin_lat IS NULL
      ORDER BY trip_ticket_id LIMIT 12`
  );
  for (const t of trips) {
    const o = davao.find((d) => (t.origin || "").includes(d.name)) || davao[0];
    const d = davao.find((x) => (t.destination || "").includes(x.name) && x.name !== o.name) ||
      davao[(davao.indexOf(o) + 1) % davao.length];
    await conn.query(
      `UPDATE trip_tickets SET origin_lat = ?, origin_lng = ?, destination_lat = ?, destination_lng = ?
        WHERE trip_ticket_id = ?`,
      [o.lat, o.lng, d.lat, d.lng, t.trip_ticket_id]
    );
  }

  // Service interval on demo vehicles + reset the counter to just below current
  await conn.query(
    `UPDATE vehicles SET service_interval_km = 10000,
        last_service_odometer = GREATEST(0, odometer - FLOOR(RAND(vehicle_id) * 9500))
      WHERE company_id = 1 AND service_interval_km IS NULL`
  );

  // Give the first demo driver an app PIN (employee_no DRV-001 → PIN 1234)
  const [[drv]] = await conn.query(
    `SELECT driver_id FROM drivers WHERE company_id = 1 AND pin_hash IS NULL ORDER BY driver_id LIMIT 1`
  );
  if (drv) {
    const hash = await bcrypt.hash("1234", 10);
    await conn.query(
      `UPDATE drivers SET pin_hash = ?, app_enabled = 1 WHERE driver_id = ?`,
      [hash, drv.driver_id]
    );
  }
}

import db from "../../config/db.js";

const ACTIVE = "'assigned','accepted','released','in_transit'";

/**
 * GET /api/v1/fleet/availability
 * Every vehicle and driver with a live availability state, plus the active trip
 * they're on (if any). One row per resource. Feeds Fleet → Availability and the
 * dispatch assignment pickers.
 */
export async function fleetAvailability(req, res) {
  const { companyId } = req.context;

  const [vehicles] = await db.execute(
    `SELECT v.vehicle_id, v.plate_no, v.vehicle_type, v.brand, v.model, v.capacity,
            v.odometer, v.home_branch_id, b.branch_name AS home_branch, v.status,
            v.registration_expiry, v.insurance_expiry,
            (SELECT tt.ticket_no FROM trip_assignments ta
               JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
               WHERE ta.vehicle_id = v.vehicle_id AND ta.is_current = TRUE
                 AND tt.status IN (${ACTIVE}) LIMIT 1) AS current_trip_no,
            (SELECT MIN(vm.scheduled_date) FROM vehicle_maintenance vm
               WHERE vm.vehicle_id = v.vehicle_id AND vm.status = 'scheduled') AS next_maintenance,
            CASE
              WHEN v.status = 'maintenance' THEN 'maintenance'
              WHEN v.status = 'inactive' THEN 'inactive'
              WHEN EXISTS (SELECT 1 FROM trip_assignments ta
                             JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
                             WHERE ta.vehicle_id = v.vehicle_id AND ta.is_current = TRUE
                               AND tt.status IN (${ACTIVE})) THEN 'on_trip'
              ELSE 'available'
            END AS availability
     FROM vehicles v
     LEFT JOIN branches b ON b.branch_id = v.home_branch_id
     WHERE v.company_id = ?
     ORDER BY v.plate_no`,
    [companyId]
  );

  const [drivers] = await db.execute(
    `SELECT d.driver_id, d.employee_no, d.first_name, d.last_name, d.phone,
            d.license_no, d.license_type, d.license_expiry,
            d.home_branch_id, b.branch_name AS home_branch, d.status,
            (SELECT tt.ticket_no FROM trip_assignments ta
               JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
               WHERE ta.driver_id = d.driver_id AND ta.is_current = TRUE
                 AND tt.status IN (${ACTIVE}) LIMIT 1) AS current_trip_no,
            CASE
              WHEN d.status = 'inactive' THEN 'inactive'
              WHEN EXISTS (SELECT 1 FROM trip_assignments ta
                             JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
                             WHERE ta.driver_id = d.driver_id AND ta.is_current = TRUE
                               AND tt.status IN (${ACTIVE})) THEN 'on_trip'
              ELSE 'available'
            END AS availability
     FROM drivers d
     LEFT JOIN branches b ON b.branch_id = d.home_branch_id
     WHERE d.company_id = ?
     ORDER BY d.first_name, d.last_name`,
    [companyId]
  );

  res.json({ success: true, data: { vehicles, drivers } });
}

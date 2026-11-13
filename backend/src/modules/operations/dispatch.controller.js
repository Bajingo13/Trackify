import db from "../../config/db.js";
import { randomUUID } from "node:crypto";
import { publish } from "../../realtime/hub.js";
import { recordAudit } from "../../shared/audit.js";
import { manilaToday } from "../../shared/driverLicense.js";
import { buildRecommendations, SCORING_VERSION } from "./dispatchRecommendations.js";

// "Today" for licence and registration checks is the Philippine calendar date,
// passed in rather than taken from CURDATE(): a database running in UTC would
// otherwise keep an expired licence assignable from 00:00 to 08:00 Manila time,
// while the driver list and Driver App already call it expired.

async function getBoard(req, res) {
  const {
    companyId,
    branchId
  } = req.context;
  const today = manilaToday();

  const [trips] = await db.execute(
    `
    SELECT
      tt.trip_ticket_id,
      tt.ticket_no,
      tt.origin,
      tt.destination,
      tt.scheduled_departure,
      tt.scheduled_arrival,
      tt.route_duration_min,
      tt.priority,
      tt.cargo_description,
      tt.cargo_weight,
      tt.required_vehicle_type,
      c.customer_name

    FROM trip_tickets tt

    LEFT JOIN customers c
      ON c.customer_id =
         tt.customer_id

    WHERE tt.company_id = ?
      AND tt.branch_id = ?
      AND tt.status = 'approved'

    ORDER BY
      tt.scheduled_departure ASC
    `,
    [
      companyId,
      branchId
    ]
  );

  const [drivers] = await db.execute(
    `
    SELECT
      d.driver_id,
      d.employee_no,

      CONCAT(
        d.first_name,
        ' ',
        d.last_name
      ) AS driver_name,

      d.license_no,
      d.license_type,
      d.license_expiry,
      d.phone

    FROM drivers d

    WHERE d.company_id = ?
      AND d.status = 'active'
      AND d.license_expiry >= ?

      AND NOT EXISTS (
        SELECT 1 FROM compliance_documents cd
        WHERE cd.company_id = d.company_id
          AND cd.entity_type = 'driver'
          AND cd.entity_id = d.driver_id
          AND cd.expiry_date IS NOT NULL
          AND cd.expiry_date < ?
      )

      AND (
        d.home_branch_id = ?
        OR d.home_branch_id IS NULL
      )

      AND NOT EXISTS (
        SELECT 1

        FROM trip_assignments ta

        INNER JOIN trip_tickets tt
          ON tt.trip_ticket_id =
             ta.trip_ticket_id

        WHERE ta.driver_id =
              d.driver_id

          AND ta.is_current = TRUE

          AND tt.status IN (
            'assigned',
            'accepted',
            'released',
            'in_transit'
          )
      )

    ORDER BY
      d.last_name,
      d.first_name
    `,
    [
      companyId,
      today,
      today,
      branchId
    ]
  );

  const [vehicles] = await db.execute(
    `
    SELECT
      v.vehicle_id,
      v.plate_no,
      v.vehicle_type,
      v.capacity,
      v.odometer,
      v.registration_expiry,
      v.insurance_expiry

    FROM vehicles v

    WHERE v.company_id = ?
      AND v.status = 'active'

      AND (
        v.home_branch_id = ?
        OR v.home_branch_id IS NULL
      )

      AND (
        v.registration_expiry IS NULL
        OR v.registration_expiry >= ?
      )

      AND (
        v.insurance_expiry IS NULL
        OR v.insurance_expiry >= ?
      )

      AND NOT EXISTS (
        SELECT 1 FROM compliance_documents cd
        WHERE cd.company_id = v.company_id
          AND cd.entity_type = 'vehicle'
          AND cd.entity_id = v.vehicle_id
          AND cd.expiry_date IS NOT NULL
          AND cd.expiry_date < ?
      )

      AND NOT EXISTS (
        SELECT 1 FROM vehicle_maintenance vm
        WHERE vm.vehicle_id = v.vehicle_id
          AND (vm.status = 'in_progress' OR (vm.status = 'scheduled' AND vm.scheduled_date <= ?))
      )

      AND NOT EXISTS (
        SELECT 1

        FROM trip_assignments ta

        INNER JOIN trip_tickets tt
          ON tt.trip_ticket_id =
             ta.trip_ticket_id

        WHERE ta.vehicle_id =
              v.vehicle_id

          AND ta.is_current = TRUE

          AND tt.status IN (
            'assigned',
            'accepted',
            'released',
            'in_transit'
          )
      )

    ORDER BY v.plate_no
    `,
    [
      companyId,
      branchId,
      today,
      today,
      today,
      today
    ]
  );

  res.json({
    success: true,

    data: {
      unassignedTrips: trips,
      availableDrivers: drivers,
      availableVehicles: vehicles
    }
  });
}

/**
 * Rank the currently assignable resources for one approved trip.
 *
 * All inputs come from Trackify's own database. There is no maps request, AI
 * request or paid service. Cross-branch resources stay visible but rank lower
 * and still go through assignTrip's explicit confirmation safeguard.
 */
async function getRecommendations(req, res) {
  const { companyId, branchId, userId } = req.context;
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return res.status(400).json({ success: false, message: "A valid trip is required." });
  }
  const today = manilaToday();

  const [[trip]] = await db.execute(
    `SELECT trip_ticket_id AS id, ticket_no AS ticketNo, branch_id AS branchId,
            origin, origin_lat AS originLat, origin_lng AS originLng,
            cargo_weight AS cargoWeight, required_vehicle_type AS requiredVehicleType,
            status
       FROM trip_tickets
      WHERE trip_ticket_id = ? AND company_id = ? AND branch_id = ?
      LIMIT 1`,
    [tripId, companyId, branchId]
  );
  if (!trip) return res.status(404).json({ success: false, message: "Trip not found." });
  if (trip.status !== "approved") {
    return res.status(409).json({ success: false, message: "Recommendations are available for approved, unassigned trips." });
  }

  const [driverRows] = await db.execute(
    `SELECT d.driver_id AS id,
            CONCAT(d.first_name, ' ', d.last_name) AS name,
            d.employee_no AS employeeNo, d.phone,
            d.license_no AS licenseNo, d.license_type AS licenseType,
            d.license_expiry AS licenseExpiry,
            d.home_branch_id AS homeBranchId, b.branch_name AS homeBranch,
            (SELECT COUNT(DISTINCT recent.trip_ticket_id)
               FROM trip_assignments recent
               JOIN trip_tickets recent_trip ON recent_trip.trip_ticket_id = recent.trip_ticket_id
              WHERE recent.driver_id = d.driver_id
                AND recent_trip.scheduled_departure >= NOW() - INTERVAL 30 DAY
                AND recent_trip.status NOT IN ('cancelled', 'rejected')) AS recentTripCount,
            (SELECT tp.latitude FROM trip_tracking_points tp
              WHERE tp.driver_id = d.driver_id ORDER BY tp.recorded_at DESC, tp.tracking_id DESC LIMIT 1) AS lastLat,
            (SELECT tp.longitude FROM trip_tracking_points tp
              WHERE tp.driver_id = d.driver_id ORDER BY tp.recorded_at DESC, tp.tracking_id DESC LIMIT 1) AS lastLng,
            (SELECT tp.recorded_at FROM trip_tracking_points tp
              WHERE tp.driver_id = d.driver_id ORDER BY tp.recorded_at DESC, tp.tracking_id DESC LIMIT 1) AS lastLocationAt,
            (SELECT COUNT(*) FROM compliance_documents cd
              WHERE cd.company_id = d.company_id AND cd.entity_type = 'driver'
                AND cd.entity_id = d.driver_id AND cd.expiry_date IS NOT NULL AND cd.expiry_date < ?) AS expiredDocumentCount
       FROM drivers d
       LEFT JOIN branches b ON b.branch_id = d.home_branch_id
      WHERE d.company_id = ? AND d.status = 'active' AND d.license_expiry >= ?
        AND NOT EXISTS (
          SELECT 1 FROM trip_assignments busy
          JOIN trip_tickets busy_trip ON busy_trip.trip_ticket_id = busy.trip_ticket_id
          WHERE busy.driver_id = d.driver_id AND busy.is_current = TRUE
            AND busy_trip.status IN ('assigned','accepted','released','in_transit')
        )
      ORDER BY d.last_name, d.first_name`,
    [today, companyId, today]
  );

  const [vehicleRows] = await db.execute(
    `SELECT v.vehicle_id AS id, v.plate_no AS plateNo, v.vehicle_type AS type,
            v.capacity, v.odometer, v.registration_expiry AS registrationExpiry,
            v.insurance_expiry AS insuranceExpiry,
            v.home_branch_id AS homeBranchId, b.branch_name AS homeBranch,
            CASE WHEN v.insurance_expiry IS NOT NULL AND v.insurance_expiry < ? THEN 1 ELSE 0 END AS insuranceExpired,
            (SELECT COUNT(*) FROM vehicle_maintenance vm
              WHERE vm.vehicle_id = v.vehicle_id
                AND (vm.status = 'in_progress' OR (vm.status = 'scheduled' AND vm.scheduled_date <= ?))) AS blockingMaintenanceCount,
            (SELECT COUNT(*) FROM compliance_documents cd
              WHERE cd.company_id = v.company_id AND cd.entity_type = 'vehicle'
                AND cd.entity_id = v.vehicle_id AND cd.expiry_date IS NOT NULL AND cd.expiry_date < ?) AS expiredDocumentCount
       FROM vehicles v
       LEFT JOIN branches b ON b.branch_id = v.home_branch_id
      WHERE v.company_id = ? AND v.status = 'active'
        AND (v.registration_expiry IS NULL OR v.registration_expiry >= ?)
        AND NOT EXISTS (
          SELECT 1 FROM trip_assignments busy
          JOIN trip_tickets busy_trip ON busy_trip.trip_ticket_id = busy.trip_ticket_id
          WHERE busy.vehicle_id = v.vehicle_id AND busy.is_current = TRUE
            AND busy_trip.status IN ('assigned','accepted','released','in_transit')
        )
      ORDER BY v.plate_no`,
    [today, today, today, companyId, today]
  );

  const recommendation = buildRecommendations({ trip, drivers: driverRows, vehicles: vehicleRows });
  const recommendationId = randomUUID();
  await db.execute(
    `INSERT INTO dispatch_recommendation_runs
       (recommendation_id, company_id, branch_id, trip_ticket_id, requested_by,
        driver_rankings, vehicle_rankings, scoring_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      recommendationId, companyId, branchId, tripId, userId || null,
      JSON.stringify(recommendation.drivers), JSON.stringify(recommendation.vehicles), SCORING_VERSION,
    ]
  );

  res.set("Cache-Control", "no-store");
  return res.json({
    success: true,
    data: { recommendationId, trip, ...recommendation },
  });
}

async function assignTrip(req, res) {
  const {
    companyId,
    branchId,
    userId
  } = req.context;

  const tripId =
    Number(req.params.id);

  const driverId =
    Number(req.body.driverId);

  const vehicleId =
    Number(req.body.vehicleId);

  const recommendationId = /^[0-9a-f-]{36}$/i.test(String(req.body.recommendationId || ""))
    ? String(req.body.recommendationId)
    : null;

  if (!driverId || !vehicleId) {
    return res.status(400).json({
      success: false,
      message:
        "Driver and vehicle are required."
    });
  }

  const connection =
    await db.getConnection();

  try {
    await connection.beginTransaction();

    const [tripRows] =
      await connection.execute(
        `
        SELECT *
        FROM trip_tickets

        WHERE trip_ticket_id = ?
          AND company_id = ?
          AND branch_id = ?

        FOR UPDATE
        `,
        [
          tripId,
          companyId,
          branchId
        ]
      );

    if (!tripRows.length) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Trip not found."
      });
    }

    // `approved` = first dispatch; `assigned`/`accepted` = re-dispatch
    // (the "Reassign" action). Any later status is locked.
    const dispatchableFrom = ["approved", "assigned", "accepted"];
    const fromStatus = tripRows[0].status;
    if (!dispatchableFrom.includes(fromStatus)) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: `This trip is ${fromStatus.replace(/_/g, " ")} — a driver and vehicle can only be assigned before it leaves.`,
      });
    }
    const isReassign = fromStatus !== "approved";
    let recommendationContext = null;
    if (recommendationId) {
      const [[run]] = await connection.execute(
        `SELECT recommendation_id, driver_rankings, vehicle_rankings, scoring_version
           FROM dispatch_recommendation_runs
          WHERE recommendation_id = ? AND company_id = ? AND branch_id = ? AND trip_ticket_id = ?
          LIMIT 1`,
        [recommendationId, companyId, branchId, tripId]
      );
      if (run) {
        const parse = (value) => {
          if (Array.isArray(value)) return value;
          try { return JSON.parse(value || "[]"); } catch { return []; }
        };
        const driver = parse(run.driver_rankings).find((item) => Number(item.id) === driverId);
        const vehicle = parse(run.vehicle_rankings).find((item) => Number(item.id) === vehicleId);
        recommendationContext = {
          recommendationId: run.recommendation_id,
          scoringVersion: run.scoring_version,
          driver: driver ? { id: driver.id, rank: driver.rank, score: driver.score, reasons: driver.reasons } : null,
          vehicle: vehicle ? { id: vehicle.id, rank: vehicle.rank, score: vehicle.score, reasons: vehicle.reasons } : null,
        };
      }
    }

    const [drivers] =
      await connection.execute(
        `
        SELECT *
        FROM drivers

        WHERE driver_id = ?
          AND company_id = ?
          AND status = 'active'
          AND license_expiry >= ?
          AND NOT EXISTS (
            SELECT 1 FROM compliance_documents cd
            WHERE cd.company_id = drivers.company_id
              AND cd.entity_type = 'driver'
              AND cd.entity_id = drivers.driver_id
              AND cd.expiry_date IS NOT NULL
              AND cd.expiry_date < ?
          )

        FOR UPDATE
        `,
        [
          driverId,
          companyId,
          manilaToday(),
          manilaToday()
        ]
      );

    if (!drivers.length) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Driver is unavailable or ineligible."
      });
    }

    const [vehicles] =
      await connection.execute(
        `
        SELECT *
        FROM vehicles

        WHERE vehicle_id = ?
          AND company_id = ?
          AND status = 'active'
          -- the board already hides these; a request naming one directly
          -- must not get round it
          AND (registration_expiry IS NULL OR registration_expiry >= ?)
          AND (insurance_expiry IS NULL OR insurance_expiry >= ?)
          AND NOT EXISTS (
            SELECT 1 FROM compliance_documents cd
            WHERE cd.company_id = vehicles.company_id
              AND cd.entity_type = 'vehicle'
              AND cd.entity_id = vehicles.vehicle_id
              AND cd.expiry_date IS NOT NULL
              AND cd.expiry_date < ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM vehicle_maintenance vm
            WHERE vm.vehicle_id = vehicles.vehicle_id
              AND (vm.status = 'in_progress' OR (vm.status = 'scheduled' AND vm.scheduled_date <= ?))
          )

        FOR UPDATE
        `,
        [
          vehicleId,
          companyId,
          manilaToday(),
          manilaToday(),
          manilaToday(),
          manilaToday()
        ]
      );

    if (!vehicles.length) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Vehicle is unavailable or its registration has expired."
      });
    }

    const requiredType = String(tripRows[0].required_vehicle_type || "").trim();
    const actualType = String(vehicles[0].vehicle_type || "").trim();
    if (requiredType && requiredType.toLowerCase() !== actualType.toLowerCase()) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        code: "VEHICLE_TYPE_MISMATCH",
        message: `This trip requires ${requiredType}; the selected vehicle is ${actualType || "missing its type"}.`,
      });
    }
    const cargoWeight = Number(tripRows[0].cargo_weight);
    const vehicleCapacity = Number(vehicles[0].capacity);
    if (Number.isFinite(cargoWeight) && cargoWeight > 0 && (!Number.isFinite(vehicleCapacity) || vehicleCapacity <= 0)) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        code: "VEHICLE_CAPACITY_UNKNOWN",
        message: "Record the selected vehicle's capacity before assigning cargo with a known weight.",
      });
    }
    if (Number.isFinite(cargoWeight) && cargoWeight > 0 && Number.isFinite(vehicleCapacity) && vehicleCapacity > 0 && cargoWeight > vehicleCapacity) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        code: "VEHICLE_CAPACITY_EXCEEDED",
        message: `Cargo is ${cargoWeight.toLocaleString()} kg but the selected vehicle carries ${vehicleCapacity.toLocaleString()} kg.`,
      });
    }

    // "Busy" means: currently the assigned resource on a trip that is still
    // running. A trip that has closed/cancelled/rejected frees the resource,
    // even if its assignment row is still flagged is_current (matches the
    // logic the Fleet views use). Re-assigning the same trip never conflicts
    // with itself.
    const [driverConflict] =
      await connection.execute(
        `
        SELECT ta.assignment_id
        FROM trip_assignments ta
        JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
        WHERE ta.driver_id = ?
          AND ta.is_current = TRUE
          AND ta.trip_ticket_id <> ?
          AND tt.status IN (
            'assigned', 'accepted', 'released', 'in_transit'
          )
        LIMIT 1
        `,
        [driverId, tripId]
      );

    if (driverConflict.length) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Driver already has an active assignment."
      });
    }

    const [vehicleConflict] =
      await connection.execute(
        `
        SELECT ta.assignment_id
        FROM trip_assignments ta
        JOIN trip_tickets tt ON tt.trip_ticket_id = ta.trip_ticket_id
        WHERE ta.vehicle_id = ?
          AND ta.is_current = TRUE
          AND ta.trip_ticket_id <> ?
          AND tt.status IN (
            'assigned', 'accepted', 'released', 'in_transit'
          )
        LIMIT 1
        `,
        [vehicleId, tripId]
      );

    if (vehicleConflict.length) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Vehicle already has an active assignment."
      });
    }

    /* ----------------------------------------------------------------
     * Cross-branch check (currently: WARN).
     * A vehicle / driver whose home branch differs from the trip's
     * branch is allowed, but the dispatcher must confirm. Send
     * `allowCrossBranch: true` in the body to proceed.
     * NOTE: pending client decision — this may later become a hard
     * block. To switch: reject whenever `mismatched.length` regardless
     * of the flag.
     * -------------------------------------------------------------- */
    const tripBranchId = Number(tripRows[0].branch_id);
    const vehHome = vehicles[0].home_branch_id;
    const drvHome = drivers[0].home_branch_id;
    const mismatched = [];
    if (vehHome != null && Number(vehHome) !== tripBranchId) {
      mismatched.push({ kind: "vehicle", label: vehicles[0].plate_no, branchId: Number(vehHome) });
    }
    if (drvHome != null && Number(drvHome) !== tripBranchId) {
      mismatched.push({
        kind: "driver",
        label: `${drivers[0].first_name} ${drivers[0].last_name}`.trim(),
        branchId: Number(drvHome),
      });
    }

    const allowCrossBranch = req.body.allowCrossBranch === true || req.body.allowCrossBranch === "true";
    let crossBranchRemark = null;

    if (mismatched.length) {
      const ids = [tripBranchId, ...mismatched.map((m) => m.branchId)];
      const [brows] = await connection.execute(
        `SELECT branch_id, branch_name FROM branches WHERE branch_id IN (${ids.map(() => "?").join(", ")})`,
        ids
      );
      const nameOf = (id) => brows.find((b) => Number(b.branch_id) === Number(id))?.branch_name || `Branch #${id}`;
      const tripBranchName = nameOf(tripBranchId);
      const clause = mismatched
        .map((m) => `the ${m.kind} (${m.label}) is based in ${nameOf(m.branchId)}`)
        .join(", and ");

      if (!allowCrossBranch) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          code: "CROSS_BRANCH",
          message: `This trip is handled by ${tripBranchName}, but ${clause}. Assign anyway?`,
        });
      }
      crossBranchRemark = `Cross-branch assignment confirmed: trip in ${tripBranchName}; ${clause}.`;
    }

    // Supersede any earlier assignment for this trip (re-dispatch).
    await connection.execute(
      `UPDATE trip_assignments
         SET is_current = FALSE, status = 'cancelled'
       WHERE trip_ticket_id = ? AND is_current = TRUE`,
      [tripId]
    );

    const [assignmentResult] =
      await connection.execute(
        `
        INSERT INTO trip_assignments (
          company_id,
          branch_id,
          trip_ticket_id,
          driver_id,
          vehicle_id,
          assigned_by
        )

        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          companyId,
          branchId,
          tripId,
          driverId,
          vehicleId,
          userId
        ]
      );

    await connection.execute(
      `
      UPDATE trip_tickets
      SET status = 'assigned'
      WHERE trip_ticket_id = ?
      `,
      [tripId]
    );

    await connection.execute(
      `
      INSERT INTO trip_status_history (
        company_id,
        branch_id,
        trip_ticket_id,
        from_status,
        to_status,
        action,
        remarks,
        changed_by
      )

      VALUES (?, ?, ?, ?, 'assigned', ?, ?, ?)
      `,
      [
        companyId,
        branchId,
        tripId,
        fromStatus,
        isReassign ? "REASSIGN_RESOURCES" : "ASSIGN_RESOURCES",
        crossBranchRemark,
        userId
      ]
    );

    await connection.commit();

    /* Who put which driver in which truck, and when. Dispatch was unaudited
     * along with the rest of operations. */
    await recordAudit(req, {
      module: "operations",
      action: isReassign ? "trip.reassign" : "trip.assign",
      entityType: "trip_ticket",
      entityId: Number(tripId),
      summary: `${isReassign ? "Reassigned" : "Assigned"} driver and vehicle to trip ${tripId}`,
      metadata: { crossBranch: crossBranchRemark || null, recommendation: recommendationContext },
    });

    publish(companyId, branchId, {
      type: "trip:status",
      tripId: Number(tripId),
      status: "assigned",
      from: isReassign ? "assigned" : "approved",
    });

    res.status(201).json({
      success: true,

      message: isReassign
        ? "Driver and vehicle reassigned successfully."
        : "Driver and vehicle assigned successfully.",

      data: {
        assignmentId:
          assignmentResult.insertId
      }
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export { getBoard, getRecommendations, assignTrip };

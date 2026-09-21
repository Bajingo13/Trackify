import fsSync from "node:fs";
import db from "../../config/db.js";
import { generateTripNumber } from "./trip-number.service.js";
import { runTransition } from "./trip-status.service.js";
import { route as computeRoute } from "./geo.service.js";
import { recordAudit } from "../../shared/audit.js";

const coord = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The parts of an address, bounded to their columns.
 *
 * Trimmed to null so a blank box clears the column instead of storing "", and
 * sliced rather than rejected: a geocoder can return a long street name, and
 * refusing to save a whole trip over it would be the wrong trade.
 */
const addressParts = (a) => {
  const take = (v, max) => {
    const t = String(v ?? "").trim();
    return t ? t.slice(0, max) : null;
  };
  return {
    houseNo: take(a?.houseNumber, 40),
    street: take(a?.street, 160),
    barangay: take(a?.barangay, 120),
    city: take(a?.city, 120),
    province: take(a?.province, 120),
    postcode: take(a?.postcode, 20),
  };
};

/* ---- post-approval lifecycle (assigned → … → closed, + cancel) ---- */
export const releaseTrip = (req, res) => runTransition(req, res, "release");
export const startTrip = (req, res) => runTransition(req, res, "start");
export const closeTrip = (req, res) => runTransition(req, res, "close");

export const deliverTrip = (req, res) => {
  const receivedBy = String(req.body.receivedBy || "").trim();
  const note = String(req.body.remarks || "").trim();
  if (!receivedBy) {
    return res.status(400).json({ success: false, message: "Received-by name is required for proof of delivery." });
  }
  const remarks = `POD — received by ${receivedBy}${note ? ` · ${note}` : ""}`;
  return runTransition(req, res, "deliver", remarks);
};

export const cancelTrip = (req, res) => {
  const reason = String(req.body.reason || req.body.remarks || "").trim();
  if (!reason) {
    return res.status(400).json({ success: false, message: "A cancellation reason is required." });
  }
  return runTransition(req, res, "cancel", reason);
};

async function listTrips(req, res) {
  const { companyId, branchId } =
    req.context;

  const {
    status,
    search = "",
    barangay = "",
    page = 1,
    limit = 20
  } = req.query;

  const pageNumber = Math.max(
    Number(page) || 1,
    1
  );

  const pageSize = Math.min(
    Math.max(Number(limit) || 20, 1),
    100
  );

  const offset =
    (pageNumber - 1) * pageSize;

  const filters = [
    "tt.company_id = ?",
    "tt.branch_id = ?"
  ];

  const params = [
    companyId,
    branchId
  ];

  if (status && status !== "all") {
    filters.push("tt.status = ?");
    params.push(status);
  }

  /*
   * The barangay filter. Philippine operations are organised by barangay — it
   * is how a dispatcher groups a day's drops — and it matches either end of the
   * trip because "what did we run to Sasa" and "what did we collect from Sasa"
   * are the same question asked from opposite directions.
   *
   * Matched exactly rather than with LIKE, so the (company_id, barangay) index
   * added with these columns is actually used; a leading wildcard would force a
   * scan and make the index ornamental.
   */
  if (barangay.trim()) {
    /*
     * Stops count too. On a multi-drop run most of the deliveries happen at a
     * waypoint rather than at the destination, so a filter reading only the two
     * ends answers "what did we do in Sasa" by hiding most of it.
     *
     * EXISTS rather than a join, so a trip with three stops in the barangay
     * still returns one row instead of three.
     */
    filters.push(`(
      tt.origin_barangay = ?
      OR tt.destination_barangay = ?
      OR EXISTS (
        SELECT 1 FROM trip_stops ts
         WHERE ts.trip_ticket_id = tt.trip_ticket_id
           AND ts.stop_barangay = ?
      )
    )`);
    params.push(barangay.trim(), barangay.trim(), barangay.trim());
  }

  if (search.trim()) {
    const value = `%${search.trim()}%`;

    filters.push(`
      (
        tt.ticket_no LIKE ?
        OR tt.origin LIKE ?
        OR tt.destination LIKE ?
        OR tt.purpose LIKE ?
        OR c.customer_name LIKE ?
      )
    `);

    params.push(
      value,
      value,
      value,
      value,
      value
    );
  }

  const whereSql =
    filters.join(" AND ");

  const [rows] = await db.execute(
    `
    SELECT
      tt.trip_ticket_id,
      tt.ticket_no,
      tt.purpose,

      tt.origin,
      tt.origin_lat,
      tt.origin_lng,
      tt.origin_house_no,
      tt.origin_street,
      tt.origin_barangay,
      tt.origin_city,
      tt.origin_province,
      tt.origin_postcode,
      tt.destination,
      tt.destination_lat,
      tt.destination_lng,
      tt.destination_house_no,
      tt.destination_street,
      tt.destination_barangay,
      tt.destination_city,
      tt.destination_province,
      tt.destination_postcode,
      /* The barangays this trip stops in, so a list can be filtered by them the
       * way the two ends already are. Concatenated in a subquery rather than
       * joined: a join multiplies the row per stop, and the same trip would
       * appear three times because it had three drops. Pipe-separated because
       * a barangay name can contain a comma. */
      (SELECT GROUP_CONCAT(DISTINCT ts.stop_barangay SEPARATOR '|')
         FROM trip_stops ts
        WHERE ts.trip_ticket_id = tt.trip_ticket_id
          AND ts.stop_barangay IS NOT NULL
          AND ts.stop_barangay <> '') AS stop_barangays,
      tt.route_distance_km,
      tt.route_duration_min,
      -- route_geometry deliberately omitted here: it's a large JSON blob and this
      -- list query does a filesort (ORDER BY created_at) that would run out of
      -- sort memory. The detail view (getTrip) returns it via tt.*.

      tt.scheduled_departure,
      tt.scheduled_arrival,

      tt.actual_departure,
      tt.actual_arrival,

      tt.priority,
      tt.status,
      tt.cargo_weight,

      c.customer_id,
      c.customer_name,

      ta.assignment_id,
      ta.driver_id,
      ta.vehicle_id,

      CONCAT(
        d.first_name,
        ' ',
        d.last_name
      ) AS driver_name,

      v.plate_no,
      v.vehicle_type,
      v.capacity AS vehicle_capacity,

      tt.created_at,
      tt.updated_at

    FROM trip_tickets tt

    LEFT JOIN customers c
      ON c.customer_id =
         tt.customer_id

    LEFT JOIN trip_assignments ta
      ON ta.trip_ticket_id =
         tt.trip_ticket_id
      AND ta.is_current = TRUE

    LEFT JOIN drivers d
      ON d.driver_id = ta.driver_id

    LEFT JOIN vehicles v
      ON v.vehicle_id = ta.vehicle_id

    WHERE ${whereSql}

    ORDER BY
      tt.created_at DESC

    LIMIT ${pageSize}
    OFFSET ${offset}
    `,
    params
  );

  const [countRows] =
    await db.execute(
      `
      SELECT COUNT(*) AS total

      FROM trip_tickets tt

      LEFT JOIN customers c
        ON c.customer_id =
           tt.customer_id

      WHERE ${whereSql}
      `,
      params
    );

  const total =
    Number(countRows[0].total);

  res.json({
    success: true,
    data: rows,

    pagination: {
      page: pageNumber,
      limit: pageSize,
      total,
      totalPages:
        Math.ceil(total / pageSize)
    }
  });
}

async function getTrip(req, res) {
  const { companyId, branchId } =
    req.context;

  const tripId =
    Number(req.params.id);

  const [rows] = await db.execute(
    `
    SELECT
      tt.*,

      c.customer_name,

      ta.assignment_id,
      ta.driver_id,
      ta.vehicle_id,
      ta.status AS assignment_status,

      CONCAT(
        d.first_name,
        ' ',
        d.last_name
      ) AS driver_name,

      v.plate_no,
      v.vehicle_type

    FROM trip_tickets tt

    LEFT JOIN customers c
      ON c.customer_id =
         tt.customer_id

    LEFT JOIN trip_assignments ta
      ON ta.trip_ticket_id =
         tt.trip_ticket_id
      AND ta.is_current = TRUE

    LEFT JOIN drivers d
      ON d.driver_id = ta.driver_id

    LEFT JOIN vehicles v
      ON v.vehicle_id = ta.vehicle_id

    WHERE tt.trip_ticket_id = ?
      AND tt.company_id = ?
      AND tt.branch_id = ?

    LIMIT 1
    `,
    [
      tripId,
      companyId,
      branchId
    ]
  );

  if (!rows.length) {
    return res.status(404).json({
      success: false,
      message: "Trip not found."
    });
  }

  const [stops] = await db.execute(
    `
    SELECT *
    FROM trip_stops
    WHERE trip_ticket_id = ?
    ORDER BY stop_order
    `,
    [tripId]
  );

  // proof of delivery, if the driver has confirmed one
  const [[pod]] = await db.execute(
    `
    SELECT p.pod_id, p.received_by, p.note, p.captured_lat, p.captured_lng,
           p.captured_at, p.photo_path IS NOT NULL AS has_photo,
           CONCAT(d.first_name, ' ', d.last_name) AS driver_name
      FROM trip_pod p
      LEFT JOIN drivers d ON d.driver_id = p.driver_id
     WHERE p.trip_ticket_id = ? AND p.company_id = ?
     LIMIT 1
    `,
    [tripId, companyId]
  );

  const [history] = await db.execute(
    `
    SELECT
      h.*,
      CONCAT(
        u.first_name,
        ' ',
        u.last_name
      ) AS changed_by_name

    FROM trip_status_history h

    LEFT JOIN users u
      ON u.user_id = h.changed_by

    WHERE h.trip_ticket_id = ?

    ORDER BY
      h.created_at DESC
    `,
    [tripId]
  );

  res.json({
    success: true,

    data: {
      ...rows[0],
      stops,
      history,
      pod: pod || null
    }
  });
}

/**
 * Lightweight cached route for one trip — just geometry + distance + duration.
 * Kept out of the list/active-trips queries because the geometry JSON is large
 * enough to blow MySQL's sort buffer when those queries filesort. If the route
 * isn't cached yet it is computed once and stored.
 */
async function getTripRoute(req, res) {
  const { companyId, branchId } = req.context;
  const tripId = Number(req.params.id);

  const [rows] = await db.execute(
    `SELECT origin_lat, origin_lng, destination_lat, destination_lng,
            route_distance_km, route_duration_min, route_geometry
       FROM trip_tickets
      WHERE trip_ticket_id = ? AND company_id = ? AND branch_id = ? LIMIT 1`,
    [tripId, companyId, branchId]
  );
  if (!rows.length) {
    return res.status(404).json({ success: false, message: "Trip not found." });
  }
  const t = rows[0];

  if (!t.route_geometry && t.origin_lat != null && t.destination_lat != null) {
    const [sw] = await db.execute(
      "SELECT latitude, longitude FROM trip_stops WHERE trip_ticket_id = ? ORDER BY stop_order",
      [tripId]
    );
    const wps = sw
      .map((s) => ({ lat: coord(s.latitude), lng: coord(s.longitude) }))
      .filter((s) => s.lat != null && s.lng != null);
    const info = await computeRoute(
      { lat: t.origin_lat, lng: t.origin_lng },
      { lat: t.destination_lat, lng: t.destination_lng },
      wps
    );
    if (info?.geometry) {
      await db.execute(
        `UPDATE trip_tickets
            SET route_distance_km = ?, route_duration_min = ?, route_geometry = ?
          WHERE trip_ticket_id = ?`,
        [info.distanceKm, info.durationMin, JSON.stringify(info.geometry), tripId]
      );
      t.route_distance_km = info.distanceKm;
      t.route_duration_min = info.durationMin;
      t.route_geometry = info.geometry;
    }
  }

  res.json({
    success: true,
    data: {
      distanceKm: t.route_distance_km != null ? Number(t.route_distance_km) : null,
      durationMin: t.route_duration_min != null ? Number(t.route_duration_min) : null,
      geometry: t.route_geometry || null,
    },
  });
}

async function createTrip(req, res) {
  const {
    companyId,
    branchId,
    userId
  } = req.context;

  const {
    customerId,
    purpose,
    origin,
    destination,

    scheduledDeparture,
    scheduledArrival,

    priority = "normal",
    dispatchMode = "dispatcher",

    cargoDescription,
    cargoQuantity,
    cargoWeight,
    specialHandling,

    dispatchNotes,
    specialInstructions,
    stops = []
  } = req.body;

  // The address behind the pin. The picker returns these with every search
  // result and every dropped pin, so a trip that was placed on the map carries
  // its street and barangay without anyone retyping them. A trip typed by hand
  // simply leaves them null.
  const oAddr = addressParts(req.body.originAddress);
  const dAddr = addressParts(req.body.destinationAddress);

  const oLat = coord(req.body.originLat);
  const oLng = coord(req.body.originLng);
  const dLat = coord(req.body.destinationLat);
  const dLng = coord(req.body.destinationLng);
  const stopWaypoints = (Array.isArray(stops) ? stops : [])
    .map((s) => ({ lat: coord(s.latitude), lng: coord(s.longitude) }))
    .filter((s) => s.lat != null && s.lng != null);
  const routeInfo =
    oLat != null && oLng != null && dLat != null && dLng != null
      ? await computeRoute({ lat: oLat, lng: oLng }, { lat: dLat, lng: dLng }, stopWaypoints)
      : null;

  if (
    !purpose?.trim() ||
    !origin?.trim() ||
    !destination?.trim() ||
    !scheduledDeparture
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Purpose, origin, destination, and scheduled departure are required."
    });
  }

  if (customerId) {
    const [customer] =
      await db.execute(
        `
        SELECT customer_id
        FROM customers
        WHERE customer_id = ?
          AND company_id = ?
          AND status = 'active'
        `,
        [
          customerId,
          companyId
        ]
      );

    if (!customer.length) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid customer for this company."
      });
    }
  }

  const connection =
    await db.getConnection();

  try {
    await connection.beginTransaction();

    const ticketNo =
      await generateTripNumber(
        connection,
        companyId,
        branchId
      );

    const [result] =
      await connection.execute(
        `
        INSERT INTO trip_tickets (
          company_id,
          branch_id,

          ticket_no,
          customer_id,

          purpose,
          origin,
          origin_lat,
          origin_lng,
          origin_house_no,
          origin_street,
          origin_barangay,
          origin_city,
          origin_province,
          origin_postcode,
          destination,
          destination_lat,
          destination_lng,
          destination_house_no,
          destination_street,
          destination_barangay,
          destination_city,
          destination_province,
          destination_postcode,
          route_distance_km,
          route_duration_min,
          route_geometry,

          scheduled_departure,
          scheduled_arrival,

          dispatch_mode,
          priority,

          cargo_description,
          cargo_quantity,
          cargo_weight,
          special_handling,

          dispatch_notes,
          special_instructions,

          created_by
        )

        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )
        `,
        [
          companyId,
          branchId,

          ticketNo,
          customerId || null,

          purpose.trim(),
          origin.trim(),
          oLat,
          oLng,
          oAddr.houseNo,
          oAddr.street,
          oAddr.barangay,
          oAddr.city,
          oAddr.province,
          oAddr.postcode,
          destination.trim(),
          dLat,
          dLng,
          dAddr.houseNo,
          dAddr.street,
          dAddr.barangay,
          dAddr.city,
          dAddr.province,
          dAddr.postcode,
          routeInfo?.distanceKm ?? null,
          routeInfo?.durationMin ?? null,
          routeInfo?.geometry ? JSON.stringify(routeInfo.geometry) : null,

          scheduledDeparture,
          scheduledArrival || null,

          dispatchMode,
          priority,

          cargoDescription || null,
          cargoQuantity || null,
          cargoWeight || null,
          specialHandling || null,

          dispatchNotes || null,
          specialInstructions || null,

          userId
        ]
      );

    const tripId =
      result.insertId;

    for (
      let index = 0;
      index < stops.length;
      index += 1
    ) {
      const stop = stops[index];

      /* Same detail a trip's two ends carry since migration 028. On a
       * multi-drop run most deliveries happen at a stop, so without this the
       * drops were invisible to the barangay question the columns exist for. */
      const stopAddr = addressParts(stop.address_parts || stop.addressParts);

      await connection.execute(
        `
        INSERT INTO trip_stops (
          trip_ticket_id,
          stop_order,
          stop_type,
          location_name,
          address,
          latitude,
          longitude,
          stop_house_no,
          stop_street,
          stop_barangay,
          stop_city,
          stop_province,
          stop_postcode,
          planned_arrival,
          notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          tripId,
          index + 1,

          stop.stopType || "waypoint",

          stop.locationName,
          stop.address || null,

          stop.latitude || null,
          stop.longitude || null,

          stopAddr.houseNo,
          stopAddr.street,
          stopAddr.barangay,
          stopAddr.city,
          stopAddr.province,
          stopAddr.postcode,

          stop.plannedArrival || null,

          stop.notes || null
        ]
      );
    }

    await connection.execute(
      `
      INSERT INTO trip_status_history (
        company_id,
        branch_id,
        trip_ticket_id,

        from_status,
        to_status,

        action,
        changed_by
      )
      VALUES (
        ?, ?, ?,
        NULL,
        'draft',
        'CREATE_TRIP',
        ?
      )
      `,
      [
        companyId,
        branchId,
        tripId,
        userId
      ]
    );

    await connection.commit();

    /*
     * Audited after the commit, never before: an entry for a trip that was
     * rolled back is a record of something that did not happen.
     *
     * The operations module wrote nothing to the audit log at all, which left
     * the core workflow of a BIR-compliance system as the one part with no
     * trail across it.
     */
    await recordAudit(req, {
      module: "operations",
      action: "trip.create",
      entityType: "trip_ticket",
      entityId: tripId,
      summary: `Created trip ${ticketNo}`,
    });

    res.status(201).json({
      success: true,
      message:
        "Trip Ticket created successfully.",

      data: {
        tripTicketId: tripId,
        ticketNo,
        status: "draft"
      }
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function submitTrip(req, res) {
  const {
    companyId,
    branchId,
    userId
  } = req.context;

  const tripId =
    Number(req.params.id);

  const connection =
    await db.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] =
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

    if (!rows.length) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Trip not found."
      });
    }

    const trip = rows[0];

    if (
      ![
        "draft",
        "rejected"
      ].includes(trip.status)
    ) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Trip cannot be submitted from its current status."
      });
    }

    await connection.execute(
      `
      UPDATE trip_tickets

      SET
        status = 'for_validation',
        submitted_by = ?,
        submitted_at = NOW(),

        rejected_by = NULL,
        rejected_at = NULL,
        rejection_reason = NULL

      WHERE trip_ticket_id = ?
      `,
      [
        userId,
        tripId
      ]
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
        changed_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        companyId,
        branchId,
        tripId,

        trip.status,
        "for_validation",

        "SUBMIT_TRIP",
        userId
      ]
    );

    await connection.execute(
      `
      INSERT INTO approval_actions (
        company_id,
        branch_id,
        trip_ticket_id,
        action,
        acted_by
      )
      VALUES (?, ?, ?, 'submitted', ?)
      `,
      [
        companyId,
        branchId,
        tripId,
        userId
      ]
    );

    await connection.commit();

    res.json({
      success: true,
      message:
        "Trip submitted for validation."
    });

    await recordAudit(req, {
      module: "operations",
      action: "trip.submit",
      entityType: "trip_ticket",
      entityId: Number(req.params.id),
      summary: `Submitted trip ${req.params.id} for validation`,
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function validateTrip(req, res) {
  const {
    companyId,
    branchId,
    userId
  } = req.context;

  const tripId =
    Number(req.params.id);

  const connection =
    await db.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] =
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

    if (!rows.length) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Trip not found."
      });
    }

    const trip = rows[0];

    if (
      trip.status !==
      "for_validation"
    ) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Trip is not waiting for validation."
      });
    }

    const errors = [];

    if (!trip.customer_id) {
      errors.push(
        "Customer is required."
      );
    }

    if (!trip.origin) {
      errors.push(
        "Origin is required."
      );
    }

    if (!trip.destination) {
      errors.push(
        "Destination is required."
      );
    }

    if (
      new Date(
        trip.scheduled_departure
      ) < new Date()
    ) {
      errors.push(
        "Scheduled departure is already in the past."
      );
    }

    if (errors.length) {
      await connection.rollback();

      return res.status(422).json({
        success: false,
        message:
          "Trip validation failed.",
        errors
      });
    }

    await connection.execute(
      `
      UPDATE trip_tickets
      SET status = 'for_approval'
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
        changed_by
      )

      VALUES (
        ?, ?, ?,
        'for_validation',
        'for_approval',
        'VALIDATE_TRIP',
        ?
      )
      `,
      [
        companyId,
        branchId,
        tripId,
        userId
      ]
    );

    await connection.execute(
      `
      INSERT INTO approval_actions (
        company_id,
        branch_id,
        trip_ticket_id,
        action,
        acted_by
      )

      VALUES (
        ?, ?, ?,
        'validated',
        ?
      )
      `,
      [
        companyId,
        branchId,
        tripId,
        userId
      ]
    );

    await connection.commit();

    await recordAudit(req, {
      module: "operations",
      action: "trip.validate",
      entityType: "trip_ticket",
      entityId: Number(req.params.id),
      summary: `Validated trip ${req.params.id} — sent for approval`,
    });

    res.json({
      success: true,
      message:
        "Trip validation passed.",
      data: {
        status: "for_approval"
      }
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function approveTrip(req, res) {
  const {
    companyId,
    branchId,
    userId
  } = req.context;

  const tripId =
    Number(req.params.id);

  const connection =
    await db.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] =
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

    if (!rows.length) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Trip not found."
      });
    }

    const trip = rows[0];

    if (
      trip.status !==
      "for_approval"
    ) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Trip is not awaiting approval."
      });
    }

    if (
      Number(trip.created_by) ===
      Number(userId)
    ) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message:
          "The Trip Ticket creator cannot approve the same Trip Ticket."
      });
    }

    await connection.execute(
      `
      UPDATE trip_tickets

      SET
        status = 'approved',
        approved_by = ?,
        approved_at = NOW()

      WHERE trip_ticket_id = ?
      `,
      [
        userId,
        tripId
      ]
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
        changed_by
      )

      VALUES (
        ?, ?, ?,
        'for_approval',
        'approved',
        'APPROVE_TRIP',
        ?
      )
      `,
      [
        companyId,
        branchId,
        tripId,
        userId
      ]
    );

    await connection.execute(
      `
      INSERT INTO approval_actions (
        company_id,
        branch_id,
        trip_ticket_id,
        action,
        acted_by
      )

      VALUES (
        ?, ?, ?,
        'approved',
        ?
      )
      `,
      [
        companyId,
        branchId,
        tripId,
        userId
      ]
    );

    await connection.commit();

    /* The entry an auditor actually asks for: who released this trip to run. */
    await recordAudit(req, {
      module: "operations",
      action: "trip.approve",
      entityType: "trip_ticket",
      entityId: Number(req.params.id),
      summary: `Approved trip ${req.params.id}`,
    });

    res.json({
      success: true,
      message:
        "Trip approved successfully."
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function rejectTrip(req, res) {
  const {
    companyId,
    branchId,
    userId
  } = req.context;

  const tripId =
    Number(req.params.id);

  const reason =
    req.body.reason?.trim();

  if (!reason) {
    return res.status(400).json({
      success: false,
      message:
        "Rejection reason is required."
    });
  }

  const connection =
    await db.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] =
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

    if (!rows.length) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Trip not found."
      });
    }

    if (
      rows[0].status !==
      "for_approval"
    ) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Trip is not awaiting approval."
      });
    }

    await connection.execute(
      `
      UPDATE trip_tickets

      SET
        status = 'rejected',
        rejected_by = ?,
        rejected_at = NOW(),
        rejection_reason = ?

      WHERE trip_ticket_id = ?
      `,
      [
        userId,
        reason,
        tripId
      ]
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

      VALUES (
        ?, ?, ?,
        'for_approval',
        'rejected',
        'REJECT_TRIP',
        ?,
        ?
      )
      `,
      [
        companyId,
        branchId,
        tripId,
        reason,
        userId
      ]
    );

    await connection.execute(
      `
      INSERT INTO approval_actions (
        company_id,
        branch_id,
        trip_ticket_id,
        action,
        reason,
        acted_by
      )

      VALUES (
        ?, ?, ?,
        'rejected',
        ?,
        ?
      )
      `,
      [
        companyId,
        branchId,
        tripId,
        reason,
        userId
      ]
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Trip rejected."
    });

    await recordAudit(req, {
      module: "operations",
      action: "trip.reject",
      entityType: "trip_ticket",
      entityId: Number(req.params.id),
      summary: `Rejected trip ${req.params.id}`,
      metadata: { remarks: req.body?.remarks || req.body?.reason || null },
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function updateTrip(req, res) {
  const {
    companyId,
    branchId,
    userId
  } = req.context;

  const tripId = Number(req.params.id);

  const {
    customerId,
    purpose,
    origin,
    destination,

    scheduledDeparture,
    scheduledArrival,

    priority,
    dispatchMode,

    cargoDescription,
    cargoQuantity,
    cargoWeight,
    specialHandling,

    dispatchNotes,
    specialInstructions,
    stops
  } = req.body;

  const bodyHasCoords =
    ["originLat", "originLng", "destinationLat", "destinationLng"].some((k) => req.body[k] !== undefined);

  // An edit that never mentions the address must leave it alone. Sending the
  // parts only when the client actually supplied them is the same rule the rest
  // of this handler follows, and the difference between correcting a departure
  // time and silently wiping a barangay.
  const oAddrSent = req.body.originAddress !== undefined;
  const dAddrSent = req.body.destinationAddress !== undefined;
  const oAddr = oAddrSent ? addressParts(req.body.originAddress) : null;
  const dAddr = dAddrSent ? addressParts(req.body.destinationAddress) : null;

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `
      SELECT *
      FROM trip_tickets

      WHERE trip_ticket_id = ?
        AND company_id = ?
        AND branch_id = ?

      FOR UPDATE
      `,
      [tripId, companyId, branchId]
    );

    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Trip not found."
      });
    }

    const trip = rows[0];

    if (!["draft", "rejected"].includes(trip.status)) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "Only draft or rejected trips can be edited."
      });
    }

    if (customerId) {
      const [customer] = await db.execute(
        `
        SELECT customer_id
        FROM customers
        WHERE customer_id = ?
          AND company_id = ?
          AND status = 'active'
        `,
        [customerId, companyId]
      );

      if (!customer.length) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Invalid customer for this company."
        });
      }
    }

    // resolve effective coordinates (body overrides, else keep stored)
    const oLat = bodyHasCoords ? coord(req.body.originLat) : coord(trip.origin_lat);
    const oLng = bodyHasCoords ? coord(req.body.originLng) : coord(trip.origin_lng);
    const dLat = bodyHasCoords ? coord(req.body.destinationLat) : coord(trip.destination_lat);
    const dLng = bodyHasCoords ? coord(req.body.destinationLng) : coord(trip.destination_lng);

    let routeKm = trip.route_distance_km;
    let routeMin = trip.route_duration_min;
    let routeGeom; // undefined → leave the stored geometry untouched
    // recompute the route when the endpoints OR the stop list changed
    const stopsChanged = Array.isArray(stops);
    if (bodyHasCoords || stopsChanged) {
      let wps = [];
      if (stopsChanged) {
        wps = stops
          .map((s) => ({ lat: coord(s.latitude), lng: coord(s.longitude) }))
          .filter((s) => s.lat != null && s.lng != null);
      } else {
        const [existing] = await connection.execute(
          "SELECT latitude, longitude FROM trip_stops WHERE trip_ticket_id = ? ORDER BY stop_order",
          [tripId]
        );
        wps = existing
          .map((s) => ({ lat: coord(s.latitude), lng: coord(s.longitude) }))
          .filter((s) => s.lat != null && s.lng != null);
      }
      const info =
        oLat != null && oLng != null && dLat != null && dLng != null
          ? await computeRoute({ lat: oLat, lng: oLng }, { lat: dLat, lng: dLng }, wps)
          : null;
      routeKm = info?.distanceKm ?? null;
      routeMin = info?.durationMin ?? null;
      routeGeom = info?.geometry ? JSON.stringify(info.geometry) : null;
    }

    await connection.execute(
      `
      UPDATE trip_tickets SET
        customer_id = ?,
        purpose = ?,
        origin = ?,
        origin_lat = ?,
        origin_lng = ?,
        origin_house_no = ?,
        origin_street = ?,
        origin_barangay = ?,
        origin_city = ?,
        origin_province = ?,
        origin_postcode = ?,
        destination = ?,
        destination_lat = ?,
        destination_lng = ?,
        destination_house_no = ?,
        destination_street = ?,
        destination_barangay = ?,
        destination_city = ?,
        destination_province = ?,
        destination_postcode = ?,
        route_distance_km = ?,
        route_duration_min = ?,
        route_geometry = IF(?, ?, route_geometry),
        scheduled_departure = ?,
        scheduled_arrival = ?,
        priority = COALESCE(?, priority),
        dispatch_mode = COALESCE(?, dispatch_mode),
        cargo_description = ?,
        cargo_quantity = ?,
        cargo_weight = ?,
        special_handling = ?,
        dispatch_notes = ?,
        special_instructions = ?
      WHERE trip_ticket_id = ?
      `,
      [
        customerId !== undefined ? customerId : trip.customer_id,
        purpose !== undefined ? purpose.trim() : trip.purpose,
        origin !== undefined ? origin.trim() : trip.origin,
        oLat,
        oLng,
        oAddrSent ? oAddr.houseNo : trip.origin_house_no,
        oAddrSent ? oAddr.street : trip.origin_street,
        oAddrSent ? oAddr.barangay : trip.origin_barangay,
        oAddrSent ? oAddr.city : trip.origin_city,
        oAddrSent ? oAddr.province : trip.origin_province,
        oAddrSent ? oAddr.postcode : trip.origin_postcode,
        destination !== undefined ? destination.trim() : trip.destination,
        dLat,
        dLng,
        dAddrSent ? dAddr.houseNo : trip.destination_house_no,
        dAddrSent ? dAddr.street : trip.destination_street,
        dAddrSent ? dAddr.barangay : trip.destination_barangay,
        dAddrSent ? dAddr.city : trip.destination_city,
        dAddrSent ? dAddr.province : trip.destination_province,
        dAddrSent ? dAddr.postcode : trip.destination_postcode,
        routeKm,
        routeMin,
        bodyHasCoords || stopsChanged ? 1 : 0,
        routeGeom ?? null,
        scheduledDeparture || trip.scheduled_departure,
        scheduledArrival !== undefined ? scheduledArrival : trip.scheduled_arrival,
        priority || null,
        dispatchMode || null,
        cargoDescription !== undefined ? cargoDescription : trip.cargo_description,
        cargoQuantity !== undefined ? cargoQuantity : trip.cargo_quantity,
        cargoWeight !== undefined ? cargoWeight : trip.cargo_weight,
        specialHandling !== undefined ? specialHandling : trip.special_handling,
        dispatchNotes !== undefined ? dispatchNotes : trip.dispatch_notes,
        specialInstructions !== undefined ? specialInstructions : trip.special_instructions,
        tripId
      ]
    );

    if (Array.isArray(stops)) {
      await connection.execute(
        "DELETE FROM trip_stops WHERE trip_ticket_id = ?",
        [tripId]
      );

      for (let index = 0; index < stops.length; index++) {
        const stop = stops[index];
        await connection.execute(
          `
          INSERT INTO trip_stops (
            trip_ticket_id, stop_order, stop_type,
            location_name, address, latitude, longitude,
            planned_arrival, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            tripId,
            index + 1,
            stop.stopType || "waypoint",
            stop.locationName,
            stop.address || null,
            stop.latitude || null,
            stop.longitude || null,
            stop.plannedArrival || null,
            stop.notes || null
          ]
        );
      }
    }

    await connection.execute(
      `
      INSERT INTO trip_status_history (
        company_id, branch_id, trip_ticket_id,
        from_status, to_status, action, changed_by
      ) VALUES (?, ?, ?, ?, ?, 'UPDATE_TRIP', ?)
      `,
      [companyId, branchId, tripId, trip.status, trip.status, userId]
    );

    await connection.commit();

    await recordAudit(req, {
      module: "operations",
      action: "trip.update",
      entityType: "trip_ticket",
      entityId: tripId,
      summary: `Updated trip ${trip.ticket_no}`,
    });

    res.json({
      success: true,
      message: "Trip updated successfully.",
      data: {
        tripTicketId: tripId,
        ticketNo: trip.ticket_no,
        status: trip.status
      }
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export {
  listTrips,
  getTrip,
  getTripRoute,
  createTrip,
  updateTrip,
  submitTrip,
  validateTrip,
  approveTrip,
  rejectTrip
};
// releaseTrip, startTrip, deliverTrip, closeTrip, cancelTrip exported inline above.
/**
 * The proof-of-delivery photo for a trip.
 *
 * Scoped to the caller's company and streamed rather than served statically —
 * a POD is the document a delivery dispute turns on, so it is not something to
 * leave sitting in a public directory.
 */
export async function getPodPhoto(req, res) {
  const { companyId } = req.context;
  const tripId = Number(req.params.id);

  const [[pod]] = await db.execute(
    `SELECT photo_path, photo_mime
       FROM trip_pod
      WHERE trip_ticket_id = ? AND company_id = ?
      LIMIT 1`,
    [tripId, companyId]
  );

  if (!pod?.photo_path) {
    return res.status(404).json({ success: false, message: "No delivery photo for this trip." });
  }

  const { toAbsolute } = await import("../finance/receipts.storage.js");
  const abs = toAbsolute(pod.photo_path);
  if (!fsSync.existsSync(abs)) {
    return res.status(404).json({ success: false, message: "The photo file is missing." });
  }

  res.type(pod.photo_mime || "image/jpeg");
  fsSync.createReadStream(abs).pipe(res);
}

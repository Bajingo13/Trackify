import db from "../../config/db.js";
import { generateTripNumber } from "./trip-number.service.js";
import { runTransition } from "./trip-status.service.js";
import { route as computeRoute } from "./geo.service.js";

const coord = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
      tt.destination,
      tt.destination_lat,
      tt.destination_lng,
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
      history
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
    const info = await computeRoute(
      { lat: t.origin_lat, lng: t.origin_lng },
      { lat: t.destination_lat, lng: t.destination_lng }
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

  const oLat = coord(req.body.originLat);
  const oLng = coord(req.body.originLng);
  const dLat = coord(req.body.destinationLat);
  const dLng = coord(req.body.destinationLng);
  const routeInfo =
    oLat != null && oLng != null && dLat != null && dLng != null
      ? await computeRoute({ lat: oLat, lng: oLng }, { lat: dLat, lng: dLng })
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
          destination,
          destination_lat,
          destination_lng,
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
          ?, ?, ?, ?, ?, ?, ?, ?, ?
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
          destination.trim(),
          dLat,
          dLng,
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
          planned_arrival,
          notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    if (bodyHasCoords) {
      const info =
        oLat != null && oLng != null && dLat != null && dLng != null
          ? await computeRoute({ lat: oLat, lng: oLng }, { lat: dLat, lng: dLng })
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
        destination = ?,
        destination_lat = ?,
        destination_lng = ?,
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
        destination !== undefined ? destination.trim() : trip.destination,
        dLat,
        dLng,
        routeKm,
        routeMin,
        bodyHasCoords ? 1 : 0,
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
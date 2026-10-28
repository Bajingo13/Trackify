import fsSync from "node:fs";
import db from "../../config/db.js";
import { generateTripNumber } from "./trip-number.service.js";
import { runTransition } from "./trip-status.service.js";
import { route as computeRoute } from "./geo.service.js";
import { recordAudit } from "../../shared/audit.js";
import { containsPattern, startsWithPattern, MAX_SEARCH_LENGTH } from "../../shared/likePattern.js";
import {
  parseTripListQuery, buildTripWhere, CUSTOMER_JOIN, ASSIGNMENT_JOINS, TRIP_STATUSES,
} from "./tripListQuery.js";

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
  return runTransition(req, res, "deliver", remarks, {
    beforeCommit: async (conn, { tripId }) => {
      const [[assignment]] = await conn.execute(
        "SELECT driver_id AS driverId FROM trip_assignments WHERE trip_ticket_id = ? AND is_current = TRUE LIMIT 1",
        [tripId]
      );
      // Dispatch does not have a phone-captured photo or GPS fix, but its form
      // fields belong in the same POD record used by chat and the trip detail.
      await conn.execute(
        `INSERT INTO trip_pod
           (trip_ticket_id, company_id, driver_id, received_by, note,
            captured_lat, captured_lng, captured_at, photo_path, photo_mime, photo_size)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, NOW(), NULL, NULL, NULL)`,
        [tripId, req.context.companyId, assignment?.driverId || null, receivedBy.slice(0, 150), note.slice(0, 255) || null]
      );
    },
  });
};

export const cancelTrip = (req, res) => {
  const reason = String(req.body.reason || req.body.remarks || "").trim();
  if (!reason) {
    return res.status(400).json({ success: false, message: "A cancellation reason is required." });
  }
  return runTransition(req, res, "cancel", reason);
};

/**
 * One page of the branch's trips, newest first, with the total that matches.
 *
 * Filtering, searching and paging all happen here, in the database. The page used
 * to ask for "everything" (up to 1000) and filter in the browser, but a page is
 * capped at 100 rows, so past that many trips the list, its counts and its export
 * were quietly incomplete. Query: status (one, or a comma list), priority,
 * barangay, from/to (scheduled departure, inclusive), search, page, limit.
 * See tripListQuery.js for the validation and the SQL condition.
 */
async function listTrips(req, res) {
  const { companyId, branchId } = req.context;
  const filters = parseTripListQuery(req.query);
  const where = buildTripWhere(filters, { companyId, branchId });
  const { page: pageNumber, pageSize, offset } = filters;

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
    ${CUSTOMER_JOIN}
    ${ASSIGNMENT_JOINS}
    WHERE ${where.sql}
    /* trip_ticket_id breaks ties. Two trips created in the same second would
     * otherwise sort in no particular order, and an unstable order across pages
     * shows one trip twice and another not at all. It is also the tail of the
     * idx_tt_scope_created index, so the sort is still read straight off it. */
    ORDER BY tt.created_at DESC, tt.trip_ticket_id DESC
    LIMIT ${pageSize}
    OFFSET ${offset}
    `,
    where.params
  );

  // Count what matches, with exactly the same condition as the page above. The
  // joins are only needed when the free-text search reads the customer, driver or
  // vehicle; a status, priority or date filter counts straight off trip_tickets.
  const [countRows] = await db.execute(
    `SELECT COUNT(*) AS total
       FROM trip_tickets tt${where.needsCustomer ? CUSTOMER_JOIN : ""}${where.needsAssignment ? ASSIGNMENT_JOINS : ""}
      WHERE ${where.sql}`,
    where.params
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
      pod: pod ? { ...pod, ...(await podSignatureOf(tripId, companyId)) } : null
    }
  });
}

/*
 * The receiver's signature on a POD (migration 062), read on its own so a
 * database without 062 still shows the trip — with no signature on it.
 */
async function podSignatureOf(tripId, companyId) {
  try {
    const [[row]] = await db.execute(
      `SELECT signature_path IS NOT NULL AS has_signature, signed_at, unsigned_reason
         FROM trip_pod WHERE trip_ticket_id = ? AND company_id = ? LIMIT 1`,
      [tripId, companyId]
    );
    return row || {};
  } catch (e) {
    if (e?.code === "ER_BAD_FIELD_ERROR") return {};
    throw e;
  }
}

/* GET /api/v1/operations/trips/:id/pod-signature — the receiver's signature, to whoever can read the trip */
export async function getPodSignature(req, res) {
  const { companyId } = req.context;
  let pod;
  try {
    [[pod]] = await db.execute(
      "SELECT signature_path, signature_mime FROM trip_pod WHERE trip_ticket_id = ? AND company_id = ? LIMIT 1",
      [Number(req.params.id), companyId]
    );
  } catch (e) {
    if (e?.code !== "ER_BAD_FIELD_ERROR") throw e;
  }
  if (!pod?.signature_path) {
    return res.status(404).json({ success: false, message: "No signature for this trip." });
  }
  const { toAbsolute, streamFile } = await import("../finance/receipts.storage.js");
  const abs = toAbsolute(pod.signature_path);
  if (!fsSync.existsSync(abs)) {
    return res.status(404).json({ success: false, message: "The signature file is missing." });
  }
  res.set("Cache-Control", "private, no-store");
  res.type(pod.signature_mime || "image/png");
  streamFile(res, abs);
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

/**
 * The numbers a trips screen needs that are not "a page of trips": how many
 * trips are in each status, and which barangays appear.
 *
 * Counted by the database (one GROUP BY, answered from idx_tt_scope_status
 * without reading the rows) instead of downloading trips to count them in the
 * browser, which is what the stat cards and the dashboard did and which stops
 * being true once there are more trips than a page holds.
 *
 * Every status is present in the answer, zero when there are none, so a client
 * never has to wonder whether a missing key means "none" or "not reported".
 */
async function tripsSummary(req, res) {
  const { companyId, branchId } = req.context;

  const [byStatus] = await db.execute(
    `SELECT status, COUNT(*) AS n
       FROM trip_tickets
      WHERE company_id = ? AND branch_id = ?
      GROUP BY status`,
    [companyId, branchId]
  );
  const counts = Object.fromEntries(TRIP_STATUSES.map((s) => [s, 0]));
  let total = 0;
  for (const row of byStatus) {
    counts[row.status] = Number(row.n);
    total += Number(row.n);
  }

  const places = await tripBarangays(companyId, branchId);

  res.json({
    success: true,
    data: { total, counts, barangays: places },
  });
}

/**
 * Every barangay this branch's trips touch, for the filter dropdown.
 *
 * Origins and destinations are read from covering indexes — the index alone
 * holds (company, branch, barangay), so no trip row is read. Left to itself the
 * optimizer picks the older (company_id, barangay) index, which cannot filter by
 * branch and has to visit every row: 4.1 s against 190 ms on 100,000 trips. The
 * hint names the index, so if it were ever missing MySQL refuses the statement
 * (error 1176); that case falls back to the same query unhinted, which is slow
 * but correct, rather than failing the page. Stops are few and read through
 * their own trip.
 */
async function tripBarangays(companyId, branchId) {
  const build = (hinted) => `
    SELECT b AS barangay FROM (
      SELECT origin_barangay AS b FROM trip_tickets
        ${hinted ? "FORCE INDEX (idx_tt_scope_origin_brgy)" : ""}
       WHERE company_id = ? AND branch_id = ? GROUP BY origin_barangay
      UNION
      SELECT destination_barangay FROM trip_tickets
        ${hinted ? "FORCE INDEX (idx_tt_scope_dest_brgy)" : ""}
       WHERE company_id = ? AND branch_id = ? GROUP BY destination_barangay
      UNION
      SELECT ts.stop_barangay FROM trip_stops ts
        JOIN trip_tickets tt ON tt.trip_ticket_id = ts.trip_ticket_id
       WHERE tt.company_id = ? AND tt.branch_id = ? GROUP BY ts.stop_barangay
    ) places
    WHERE b IS NOT NULL AND b <> ''
    ORDER BY b`;
  const params = [companyId, branchId, companyId, branchId, companyId, branchId];

  try {
    const [rows] = await db.execute(build(true), params);
    return rows.map((r) => r.barangay);
  } catch (error) {
    if (error?.errno !== 1176 && error?.code !== "ER_KEY_DOES_NOT_EXIST") throw error;
    const [rows] = await db.execute(build(false), params);
    return rows.map((r) => r.barangay);
  }
}

/**
 * Find-a-trip for the Ctrl+K palette.
 *
 * Not listTrips with a smaller limit. That query joins the assignment, driver
 * and vehicle, concatenates stop barangays, sorts the whole tenant by
 * created_at and then runs a second COUNT(*) over the same leading-wildcard
 * scan — about a second per keystroke pause at 300,000 trips, to put five
 * rows in a dropdown that never shows the total.
 *
 * Two steps instead:
 *   1. Ticket number starts with the term. This is what people type, and it is
 *      the one shape an index answers (uq_ticket_no) — about a millisecond.
 *   2. Only if that leaves room, the wider contains-match over ticket number,
 *      route, purpose and customer, walking idx_tt_scope_created newest-first
 *      so a common word stops after five hits instead of reading everything.
 *
 * A term that matches nothing still has to read the branch's trips, which is
 * why the statement carries a deadline: a runaway search is cut off by the
 * database rather than left running after the person has typed on.
 *
 * Same guard as the list (trip.read) and the same company + branch scope.
 */
const SEARCH_DEADLINE_MS = 3000;
const SEARCH_COLUMNS = `
  tt.trip_ticket_id, tt.ticket_no, tt.origin, tt.destination, c.customer_name`;

async function searchTrips(req, res) {
  const { companyId, branchId } = req.context;
  const term = String(req.query.q ?? "").trim().slice(0, MAX_SEARCH_LENGTH);
  const limit = Math.min(Math.max(Math.trunc(Number(req.query.limit)) || 5, 1), 10);

  if (term.length < 2) return res.json({ success: true, data: [] });

  try {
    const [byTicket] = await db.execute(
      `SELECT /*+ MAX_EXECUTION_TIME(${SEARCH_DEADLINE_MS}) */ ${SEARCH_COLUMNS}
         FROM trip_tickets tt
         LEFT JOIN customers c ON c.customer_id = tt.customer_id
        WHERE tt.company_id = ? AND tt.branch_id = ? AND tt.ticket_no LIKE ?
        ORDER BY tt.ticket_no DESC
        LIMIT ${limit}`,
      [companyId, branchId, startsWithPattern(term)]
    );

    let rows = byTicket;
    if (rows.length < limit) {
      const like = containsPattern(term);
      const seen = rows.map((r) => r.trip_ticket_id);
      const [wider] = await db.execute(
        `SELECT /*+ MAX_EXECUTION_TIME(${SEARCH_DEADLINE_MS}) */ ${SEARCH_COLUMNS}
           FROM trip_tickets tt
           LEFT JOIN customers c ON c.customer_id = tt.customer_id
          WHERE tt.company_id = ? AND tt.branch_id = ?
            ${seen.length ? `AND tt.trip_ticket_id NOT IN (${seen.map(() => "?").join(", ")})` : ""}
            AND (tt.ticket_no LIKE ? OR tt.origin LIKE ? OR tt.destination LIKE ?
                 OR tt.purpose LIKE ? OR c.customer_name LIKE ?)
          ORDER BY tt.created_at DESC
          LIMIT ${limit - rows.length}`,
        [companyId, branchId, ...seen, like, like, like, like, like]
      );
      rows = [...rows, ...wider];
    }

    return res.json({
      success: true,
      data: rows.map((r) => ({
        trip_ticket_id: r.trip_ticket_id,
        ticket_no: r.ticket_no,
        origin: r.origin,
        destination: r.destination,
        customer_name: r.customer_name,
      })),
    });
  } catch (error) {
    // ER_QUERY_TIMEOUT: the deadline above. Say so, rather than a bare 500.
    if (error?.errno === 3024 || error?.code === "ER_QUERY_TIMEOUT") {
      return res.status(503).json({
        success: false,
        message: "That search took too long. Try a longer or more specific term.",
      });
    }
    throw error;
  }
}

export {
  listTrips,
  tripsSummary,
  searchTrips,
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

  const { toAbsolute, streamFile } = await import("../finance/receipts.storage.js");
  const abs = toAbsolute(pod.photo_path);
  if (!fsSync.existsSync(abs)) {
    return res.status(404).json({ success: false, message: "The photo file is missing." });
  }

  res.type(pod.photo_mime || "image/jpeg");
  streamFile(res, abs);
}

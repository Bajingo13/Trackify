import db from "../../config/db.js";

async function activeTrips(req, res) {
  const {
    companyId,
    branchId
  } = req.context;

  const [rows] = await db.execute(
    `
    SELECT
      tt.trip_ticket_id,
      tt.ticket_no,
      tt.origin,
      tt.destination,
      tt.status,

      tt.scheduled_arrival,

      ta.driver_id,
      ta.vehicle_id,

      CONCAT(
        d.first_name,
        ' ',
        d.last_name
      ) AS driver_name,

      v.plate_no,

      tp.latitude,
      tp.longitude,
      tp.speed_kph,
      tp.heading,
      tp.accuracy_meters,
      tp.gps_status,
      tp.recorded_at AS last_update

    FROM trip_tickets tt

    INNER JOIN trip_assignments ta
      ON ta.trip_ticket_id =
         tt.trip_ticket_id
      AND ta.is_current = TRUE

    LEFT JOIN drivers d
      ON d.driver_id = ta.driver_id

    LEFT JOIN vehicles v
      ON v.vehicle_id = ta.vehicle_id

    LEFT JOIN trip_tracking_points tp
      ON tp.tracking_id = (

          SELECT tp2.tracking_id

          FROM trip_tracking_points tp2

          WHERE tp2.trip_ticket_id =
                tt.trip_ticket_id

          ORDER BY
            tp2.recorded_at DESC

          LIMIT 1
      )

    WHERE tt.company_id = ?
      AND tt.branch_id = ?

      AND tt.status IN (
        'released',
        'in_transit'
      )

    ORDER BY
      tt.scheduled_departure
    `,
    [
      companyId,
      branchId
    ]
  );

  res.json({
    success: true,
    data: rows
  });
}

async function addTrackingPoint(
  req,
  res
) {
  const {
    companyId,
    branchId
  } = req.context;

  const tripId =
    Number(req.params.id);

  const {
    latitude,
    longitude,
    speedKph,
    heading,
    accuracyMeters,
    gpsStatus = "online",
    recordedAt
  } = req.body;

  if (
    latitude === undefined ||
    longitude === undefined
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Latitude and longitude are required."
    });
  }

  const [tripRows] =
    await db.execute(
      `
      SELECT status
      FROM trip_tickets

      WHERE trip_ticket_id = ?
        AND company_id = ?
        AND branch_id = ?

      LIMIT 1
      `,
      [
        tripId,
        companyId,
        branchId
      ]
    );

  if (!tripRows.length) {
    return res.status(404).json({
      success: false,
      message: "Trip not found."
    });
  }

  if (
    ![
      "released",
      "in_transit"
    ].includes(tripRows[0].status)
  ) {
    return res.status(409).json({
      success: false,
      message:
        "GPS tracking is not active for this Trip Ticket."
    });
  }

  const [assignments] =
    await db.execute(
      `
      SELECT
        driver_id,
        vehicle_id

      FROM trip_assignments

      WHERE trip_ticket_id = ?
        AND is_current = TRUE

      LIMIT 1
      `,
      [tripId]
    );

  if (!assignments.length) {
    return res.status(409).json({
      success: false,
      message:
        "Trip has no active assignment."
    });
  }

  const assignment =
    assignments[0];

  const [result] =
    await db.execute(
      `
      INSERT INTO trip_tracking_points (
        company_id,
        branch_id,

        trip_ticket_id,

        driver_id,
        vehicle_id,

        latitude,
        longitude,

        speed_kph,
        heading,
        accuracy_meters,

        gps_status,

        recorded_at
      )

      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      `,
      [
        companyId,
        branchId,

        tripId,

        assignment.driver_id,
        assignment.vehicle_id,

        latitude,
        longitude,

        speedKph ?? null,
        heading ?? null,
        accuracyMeters ?? null,

        gpsStatus,

        recordedAt ||
          new Date()
      ]
    );

  res.status(201).json({
    success: true,

    data: {
      trackingId:
        result.insertId
    }
  });
}

async function trackingHistory(
  req,
  res
) {
  const {
    companyId,
    branchId
  } = req.context;

  const tripId =
    Number(req.params.id);

  const [rows] = await db.execute(
    `
    SELECT
      tracking_id,

      latitude,
      longitude,

      speed_kph,
      heading,
      accuracy_meters,

      gps_status,

      recorded_at

    FROM trip_tracking_points

    WHERE trip_ticket_id = ?
      AND company_id = ?
      AND branch_id = ?

    ORDER BY
      recorded_at ASC
    `,
    [
      tripId,
      companyId,
      branchId
    ]
  );

  res.json({
    success: true,
    data: rows
  });
}

export {
  activeTrips,
  addTrackingPoint,
  trackingHistory
};
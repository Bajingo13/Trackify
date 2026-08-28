import db from "../../config/db.js";

async function getBoard(req, res) {
  const {
    companyId,
    branchId
  } = req.context;

  const [trips] = await db.execute(
    `
    SELECT
      tt.trip_ticket_id,
      tt.ticket_no,
      tt.origin,
      tt.destination,
      tt.scheduled_departure,
      tt.priority,
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
      d.license_expiry

    FROM drivers d

    WHERE d.company_id = ?
      AND d.status = 'active'
      AND d.license_expiry >= CURDATE()

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
      v.registration_expiry

    FROM vehicles v

    WHERE v.company_id = ?
      AND v.status = 'active'

      AND (
        v.home_branch_id = ?
        OR v.home_branch_id IS NULL
      )

      AND (
        v.registration_expiry IS NULL
        OR v.registration_expiry >= CURDATE()
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
      branchId
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

    if (
      tripRows[0].status !==
      "approved"
    ) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Only approved Trip Tickets can be dispatched."
      });
    }

    const [drivers] =
      await connection.execute(
        `
        SELECT *
        FROM drivers

        WHERE driver_id = ?
          AND company_id = ?
          AND status = 'active'
          AND license_expiry >= CURDATE()

        FOR UPDATE
        `,
        [
          driverId,
          companyId
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

        FOR UPDATE
        `,
        [
          vehicleId,
          companyId
        ]
      );

    if (!vehicles.length) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Vehicle is unavailable."
      });
    }

    const [driverConflict] =
      await connection.execute(
        `
        SELECT assignment_id

        FROM trip_assignments

        WHERE driver_id = ?
          AND is_current = TRUE
          AND status IN (
            'assigned',
            'accepted'
          )

        LIMIT 1
        `,
        [driverId]
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
        SELECT assignment_id

        FROM trip_assignments

        WHERE vehicle_id = ?
          AND is_current = TRUE
          AND status IN (
            'assigned',
            'accepted'
          )

        LIMIT 1
        `,
        [vehicleId]
      );

    if (vehicleConflict.length) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Vehicle already has an active assignment."
      });
    }

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
        changed_by
      )

      VALUES (
        ?, ?, ?,
        'approved',
        'assigned',
        'ASSIGN_RESOURCES',
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
        "Driver and vehicle assigned successfully.",

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

export { getBoard, assignTrip };
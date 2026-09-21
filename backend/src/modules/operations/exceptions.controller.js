import db from "../../config/db.js";
import { mutedTypesFor } from "../admin/settings.controller.js";

async function listExceptions(
  req,
  res
) {
  const {
    companyId,
    branchId
  } = req.context;

  const {
    status,
    severity,
    type
  } = req.query;

  const conditions = [
    "oe.company_id = ?",
    "oe.branch_id = ?"
  ];

  const params = [
    companyId,
    branchId
  ];

  if (status) {
    conditions.push(
      "oe.status = ?"
    );

    params.push(status);
  }

  if (severity) {
    conditions.push(
      "oe.severity = ?"
    );

    params.push(severity);
  }

  if (type) {
    conditions.push(
      "oe.exception_type = ?"
    );

    params.push(type);
  }

  /*
   * A person's own muted alert kinds, from the Notifications screen.
   *
   * Two deliberate limits on what a mute can do. Asking for a type by name
   * overrides the mute — filtering to "failed delivery" and getting an empty
   * board because you muted it months ago is the kind of silence that costs a
   * delivery. And the muted kinds are named in the response, so the board can
   * say what it is not showing rather than looking simply empty.
   */
  const muted = type
    ? []
    : await mutedTypesFor(req.user?.userId);

  if (muted.length) {
    conditions.push(
      `oe.exception_type NOT IN (${muted.map(() => "?").join(",")})`
    );

    params.push(...muted);
  }

  const [rows] = await db.execute(
    `
    SELECT
      oe.*,

      tt.ticket_no,
      tt.origin,
      tt.destination,

      CONCAT(
        d.first_name,
        ' ',
        d.last_name
      ) AS driver_name,

      v.plate_no

    FROM operational_exceptions oe

    LEFT JOIN trip_tickets tt
      ON tt.trip_ticket_id =
         oe.trip_ticket_id

    LEFT JOIN trip_assignments ta
      ON ta.trip_ticket_id =
         oe.trip_ticket_id
      AND ta.is_current = TRUE

    LEFT JOIN drivers d
      ON d.driver_id =
         ta.driver_id

    LEFT JOIN vehicles v
      ON v.vehicle_id =
         ta.vehicle_id

    WHERE
      ${conditions.join(" AND ")}

    ORDER BY

      CASE oe.severity

        WHEN 'critical'
          THEN 1

        WHEN 'warning'
          THEN 2

        ELSE 3

      END,

      oe.detected_at DESC
    `,
    params
  );

  res.json({
    success: true,
    data: rows,
    meta: { muted }
  });
}

async function createException(
  req,
  res
) {
  const {
    companyId,
    branchId
  } = req.context;

  const {
    tripTicketId,

    exceptionType,
    severity = "warning",

    title,
    description,

    latitude,
    longitude
  } = req.body;

  if (
    !exceptionType ||
    !title?.trim()
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Exception type and title are required."
    });
  }

  if (tripTicketId) {
    const [trips] =
      await db.execute(
        `
        SELECT trip_ticket_id

        FROM trip_tickets

        WHERE trip_ticket_id = ?
          AND company_id = ?
          AND branch_id = ?

        LIMIT 1
        `,
        [
          tripTicketId,
          companyId,
          branchId
        ]
      );

    if (!trips.length) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid Trip Ticket."
      });
    }
  }

  const [result] =
    await db.execute(
      `
      INSERT INTO operational_exceptions (
        company_id,
        branch_id,

        trip_ticket_id,

        exception_type,
        severity,

        title,
        description,

        latitude,
        longitude
      )

      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      `,
      [
        companyId,
        branchId,

        tripTicketId || null,

        exceptionType,
        severity,

        title.trim(),
        description || null,

        latitude ?? null,
        longitude ?? null
      ]
    );

  res.status(201).json({
    success: true,

    message:
      "Operational exception created.",

    data: {
      exceptionId:
        result.insertId
    }
  });
}

async function acknowledgeException(
  req,
  res
) {
  const {
    companyId,
    branchId,
    userId
  } = req.context;

  const exceptionId =
    Number(req.params.id);

  const [result] =
    await db.execute(
      `
      UPDATE operational_exceptions

      SET
        status = 'acknowledged',
        acknowledged_by = ?,
        acknowledged_at = NOW()

      WHERE exception_id = ?
        AND company_id = ?
        AND branch_id = ?
        AND status = 'open'
      `,
      [
        userId,
        exceptionId,
        companyId,
        branchId
      ]
    );

  if (!result.affectedRows) {
    return res.status(409).json({
      success: false,
      message:
        "Exception cannot be acknowledged."
    });
  }

  res.json({
    success: true,
    message:
      "Exception acknowledged."
  });
}

async function resolveException(
  req,
  res
) {
  const {
    companyId,
    branchId,
    userId
  } = req.context;

  const exceptionId =
    Number(req.params.id);

  const notes =
    req.body.resolutionNotes?.trim();

  if (!notes) {
    return res.status(400).json({
      success: false,
      message:
        "Resolution notes are required."
    });
  }

  const [result] =
    await db.execute(
      `
      UPDATE operational_exceptions

      SET
        status = 'resolved',

        resolved_by = ?,
        resolved_at = NOW(),

        resolution_notes = ?

      WHERE exception_id = ?
        AND company_id = ?
        AND branch_id = ?
        AND status <> 'resolved'
      `,
      [
        userId,
        notes,

        exceptionId,
        companyId,
        branchId
      ]
    );

  if (!result.affectedRows) {
    return res.status(409).json({
      success: false,
      message:
        "Exception does not exist or is already resolved."
    });
  }

  res.json({
    success: true,
    message:
      "Exception resolved."
  });
}

export {
  listExceptions,
  createException,
  acknowledgeException,
  resolveException
};
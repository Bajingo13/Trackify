/**
 * The settings screens, and nothing they cannot actually do.
 *
 * Both screens rendered a placeholder until now. The temptation with a settings
 * page is to fill it with plausible controls; a toggle that changes nothing is
 * the same lie as a document describing a feature that does not exist, and
 * worse in one way — somebody sets it, believes it took, and finds out when it
 * matters. So this exposes only what is wired to behaviour.
 */
import db from "../../config/db.js";
import { verifyUploadStorage } from "../finance/receipts.storage.js";
import { recordAudit } from "../../shared/audit.js";
import {
  settingsFor,
  normalisePrefix,
  normaliseRetention,
  DEFAULTS,
  MIN_RETENTION_MONTHS,
  MAX_RETENTION_MONTHS,
} from "../../shared/companySettings.js";

/* The alert kinds the system raises. A mute for anything else is meaningless,
 * so it is refused rather than stored and silently ignored. */
export const ALERT_TYPES = [
  "trip_delay",
  "route_deviation",
  "gps_offline",
  "vehicle_breakdown",
  "driver_declined",
  "failed_delivery",
  "cargo_shortage",
  "cargo_damage",
  "missing_pod",
  "schedule_conflict",
  "vehicle_maintenance_block",
  "driver_license_issue",
];

/* ---------------------------------------------------------------- */
/* Company defaults                                                 */
/* ---------------------------------------------------------------- */

export async function getCompanySettings(req, res) {
  const { companyId } = req.context;
  const settings = await settingsFor(companyId);

  res.json({
    success: true,
    data: {
      ...settings,
      defaults: DEFAULTS,
      retentionRange: { min: MIN_RETENTION_MONTHS, max: MAX_RETENTION_MONTHS },
      /* So the screen can show what the next ticket will look like rather than
       * describing the format in prose and hoping it is read. */
      sampleTicketNo: `${settings.tripPrefix}-${new Date().getFullYear()}-000123`,
    },
  });
}

export async function updateCompanySettings(req, res) {
  const { companyId, userId } = req.context;
  const current = await settingsFor(companyId);

  const wantsPrefix = req.body.tripPrefix !== undefined;
  const wantsRetention = req.body.locationRetentionMonths !== undefined;

  const tripPrefix = wantsPrefix ? normalisePrefix(req.body.tripPrefix) : current.tripPrefix;
  if (wantsPrefix && !tripPrefix) {
    return res.status(400).json({
      success: false,
      message: "A ticket prefix is 1 to 10 characters, starts with a letter, and uses only letters, digits and dashes.",
    });
  }

  const months = wantsRetention
    ? normaliseRetention(req.body.locationRetentionMonths)
    : current.locationRetentionMonths;
  if (wantsRetention && !months) {
    return res.status(400).json({
      success: false,
      message: `Keep the location trail for between ${MIN_RETENTION_MONTHS} and ${MAX_RETENTION_MONTHS} months.`,
    });
  }

  await db.execute(
    `INSERT INTO company_settings (company_id, trip_prefix, location_retention_months, updated_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       trip_prefix = VALUES(trip_prefix),
       location_retention_months = VALUES(location_retention_months),
       updated_by = VALUES(updated_by)`,
    [companyId, tripPrefix, months, userId || null]
  );

  /*
   * Both of these are worth an audit entry in their own right. Changing the
   * ticket prefix changes how every document from now on is identified, and
   * shortening the retention period destroys data on a schedule — neither is
   * something that should be discoverable only by noticing it happened.
   */
  const changes = [];
  if (tripPrefix !== current.tripPrefix) changes.push(`prefix ${current.tripPrefix} → ${tripPrefix}`);
  if (months !== current.locationRetentionMonths) {
    changes.push(`location trail ${current.locationRetentionMonths} → ${months} months`);
  }

  if (changes.length) {
    await recordAudit(req, {
      module: "admin",
      action: "settings.company.update",
      entityType: "company",
      entityId: companyId,
      summary: `Changed company settings: ${changes.join(", ")}`,
      metadata: { from: current, to: { tripPrefix, locationRetentionMonths: months } },
    });
  }

  res.json({ success: true, data: { tripPrefix, locationRetentionMonths: months } });
}

/* ---------------------------------------------------------------- */
/* Per-person alert mutes                                           */
/* ---------------------------------------------------------------- */

/*
 * Mutes, not subscriptions. Alerts are raised because something needs
 * attention, so the default must be that a person sees them: somebody who has
 * never opened this screen cannot be the one who missed a failed delivery.
 */

export async function getMyAlertPreferences(req, res) {
  const [rows] = await db.execute(
    "SELECT exception_type FROM user_alert_mutes WHERE user_id = ?",
    [req.user.userId]
  );

  res.json({
    success: true,
    data: {
      types: ALERT_TYPES,
      muted: rows.map((r) => r.exception_type),
    },
  });
}

export async function setMyAlertPreferences(req, res) {
  const userId = req.user.userId;
  const requested = Array.isArray(req.body.muted) ? req.body.muted : [];

  const unknown = requested.filter((t) => !ALERT_TYPES.includes(t));
  if (unknown.length) {
    // Storing a mute for an alert that does not exist would look like it took
    // and do nothing, which is the failure this whole screen has to avoid.
    return res.status(400).json({
      success: false,
      message: `Not a kind of alert this system raises: ${unknown.join(", ")}`,
    });
  }

  const muted = [...new Set(requested)];

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("DELETE FROM user_alert_mutes WHERE user_id = ?", [userId]);
    for (const type of muted) {
      // eslint-disable-next-line no-await-in-loop
      await connection.execute(
        "INSERT INTO user_alert_mutes (user_id, exception_type) VALUES (?, ?)",
        [userId, type]
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }

  res.json({ success: true, data: { muted } });
}

/** The types this user has muted, for the exceptions list to leave out. */
export async function mutedTypesFor(userId, runner = db) {
  if (!userId) return [];
  const [rows] = await runner.execute(
    "SELECT exception_type FROM user_alert_mutes WHERE user_id = ?",
    [userId]
  );
  return rows.map((r) => r.exception_type);
}

/* ---------------------------------------------------------------- */
/* Integrations                                                     */
/* ---------------------------------------------------------------- */

/**
 * What is actually connected, read from the running server.
 *
 * The Integrations page used to list six services over a line admitting that
 * none of them could be connected. Two of the six are in fact wired and
 * configurable — the geocoder and the file store — and an operator has no
 * other way to find out whether uploads are landing on a disk that survives a
 * redeploy, which on a container host is the difference between having proof
 * of delivery and not.
 *
 * So this reports the state rather than a plan, and the four that do not exist
 * say so in their own words instead of being dressed up as "coming soon".
 */
export async function getIntegrations(req, res) {
  const storage = await verifyUploadStorage();

  const geocoder = (process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
  const selfHostedGeocoder = !/(^|\.)nominatim\.openstreetmap\.org$/i.test(
    (() => { try { return new URL(geocoder).hostname; } catch { return ""; } })()
  );

  res.json({
    success: true,
    data: [
      {
        key: "maps",
        name: "Address search",
        state: "connected",
        summary: selfHostedGeocoder
          ? `Self-hosted geocoder at ${geocoder}`
          : "Public OpenStreetMap geocoder (Nominatim)",
        detail: selfHostedGeocoder
          ? "Your own instance, so the one-request-per-second courtesy limit does not apply."
          : "Free and shared, so requests are spaced one second apart and heavy use may be throttled. Set NOMINATIM_URL to a self-hosted instance to remove that.",
      },
      {
        key: "storage",
        name: "File storage",
        state: storage.ok ? (storage.persistent ? "connected" : "attention") : "problem",
        summary: storage.ok
          ? storage.persistent
            ? "Persistent volume — files survive a redeploy"
            : "Local disk on this server"
          : "Not writable",
        detail: storage.ok
          ? storage.persistent
            ? "Receipts, proof of delivery, licences and compliance documents are written to a mounted volume."
            : "Fine for a development machine. On a container host, files written here are lost on the next deploy — set UPLOAD_ROOT to a mounted volume before go-live."
          : `The upload directory could not be written to (${storage.error}). Photo and receipt uploads will fail until this is fixed.`,
      },
      {
        key: "email",
        name: "Email",
        state: "absent",
        summary: "Not set up",
        detail: "The system sends no email at all. That is why there is no password reset link and why alerts are shown in the console rather than delivered.",
      },
      {
        key: "sms",
        name: "SMS",
        state: "absent",
        summary: "Not set up",
        detail: "Drivers are reached through the Driver App, not by text message.",
      },
      {
        key: "webhooks",
        name: "Webhooks",
        state: "absent",
        summary: "Not built",
        detail: "Nothing pushes trip or exception events to an outside system yet.",
      },
      {
        key: "accounting",
        name: "Accounting export",
        state: "absent",
        summary: "Not built",
        detail: "Finance records are exported from the Reports screens by hand. A direct sync depends on which package the client runs.",
      },
    ],
  });
}

/**
 * A company's own photograph for a kind of vehicle.
 *
 * The app ships four photographs across ten body shapes, so several types are
 * currently shown something close rather than something right — a Closed Van
 * gets a box truck, a Wing Van gets a curtainsider. Shipping more photographs
 * only postpones it: the next operator runs a body type nobody here has a
 * picture of.
 *
 * So an operator can supply their own, and it wins everywhere a vehicle of
 * that type is drawn — fleet, dispatch, tracking, and the driver's phone. The
 * bundled photograph stays underneath as a fallback, and the drawn silhouette
 * underneath that, so removing a company photo restores the old behaviour
 * rather than leaving a hole.
 */
import fsSync from "node:fs";
import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { toRelative, toAbsolute, discard } from "../finance/receipts.storage.js";

/** The label is free text on the vehicle row, so it is bounded here instead. */
function cleanType(raw) {
  const t = String(raw || "").trim();
  if (!t) {
    throw Object.assign(new Error("A vehicle type is required."), { status: 400 });
  }
  if (t.length > 100) {
    throw Object.assign(new Error("That vehicle type name is too long."), { status: 400 });
  }
  return t;
}

/**
 * What the app needs to know before it renders anything: which types have a
 * company photograph, and when each last changed.
 *
 * Deliberately not the images themselves. The client turns this into one
 * request per type it actually has to draw, which for a real fleet is a
 * handful — and the timestamp is what lets those be cached hard and still
 * refresh the moment somebody uploads a replacement.
 */
export async function listTypePhotos(req, res) {
  const { companyId } = req.context;
  const [rows] = await db.execute(
    `SELECT vehicle_type, photo_mime, photo_size, updated_at
       FROM vehicle_type_photos
      WHERE company_id = ?
      ORDER BY vehicle_type`,
    [companyId]
  );
  res.json({
    success: true,
    data: rows.map((r) => ({
      vehicleType: r.vehicle_type,
      mime: r.photo_mime,
      bytes: r.photo_size,
      updatedAt: r.updated_at,
    })),
  });
}

export async function uploadTypePhoto(req, res) {
  const { companyId } = req.context;
  const vehicleType = cleanType(req.params.type);

  if (!req.file) {
    discard(req.file?.path);
    return res.status(400).json({ success: false, message: "No photo was attached." });
  }

  const [[existing]] = await db.execute(
    `SELECT photo_path FROM vehicle_type_photos
      WHERE company_id = ? AND vehicle_type = ? LIMIT 1`,
    [companyId, vehicleType]
  );

  try {
    // One row per company and type, so a replacement updates rather than
    // accumulating rows the next read would have to choose between.
    await db.execute(
      `INSERT INTO vehicle_type_photos
         (company_id, vehicle_type, photo_path, photo_mime, photo_size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         photo_path = VALUES(photo_path),
         photo_mime = VALUES(photo_mime),
         photo_size = VALUES(photo_size),
         uploaded_by = VALUES(uploaded_by)`,
      [
        companyId,
        vehicleType,
        toRelative(req.file.path),
        req.file.mimetype,
        req.file.size,
        req.user?.userId || null,
      ]
    );
  } catch (e) {
    discard(req.file.path);
    throw e;
  }

  // Only after the row points at the new file. The other order loses the
  // photograph if the write fails.
  if (existing?.photo_path) {
    try {
      discard(toAbsolute(existing.photo_path));
    } catch {
      /* already gone */
    }
  }

  await recordAudit(req, {
    module: "fleet",
    action: "vehicle.type_photo.set",
    entityType: "vehicle_type",
    summary: `Set the photo for ${vehicleType}`,
  });

  res.json({ success: true, data: { vehicleType, updatedAt: new Date() } });
}

export async function removeTypePhoto(req, res) {
  const { companyId } = req.context;
  const vehicleType = cleanType(req.params.type);

  const [[row]] = await db.execute(
    `SELECT photo_path FROM vehicle_type_photos
      WHERE company_id = ? AND vehicle_type = ? LIMIT 1`,
    [companyId, vehicleType]
  );
  if (!row) {
    return res.status(404).json({ success: false, message: "There is no photo for that type." });
  }

  await db.execute(
    `DELETE FROM vehicle_type_photos WHERE company_id = ? AND vehicle_type = ?`,
    [companyId, vehicleType]
  );
  try {
    discard(toAbsolute(row.photo_path));
  } catch {
    /* already gone */
  }

  await recordAudit(req, {
    module: "fleet",
    action: "vehicle.type_photo.clear",
    entityType: "vehicle_type",
    summary: `Removed the photo for ${vehicleType}`,
  });

  res.json({ success: true });
}

export async function serveTypePhoto(req, res) {
  const { companyId } = req.context;
  const vehicleType = cleanType(req.params.type);

  const [[row]] = await db.execute(
    `SELECT photo_path, photo_mime FROM vehicle_type_photos
      WHERE company_id = ? AND vehicle_type = ? LIMIT 1`,
    [companyId, vehicleType]
  );
  if (!row) {
    return res.status(404).json({ success: false, message: "No photo for that type." });
  }

  const abs = toAbsolute(row.photo_path);
  if (!fsSync.existsSync(abs)) {
    return res.status(404).json({ success: false, message: "The photo file is missing." });
  }

  // Cached hard because the client only asks after reading the manifest, and
  // the manifest's updated_at is carried in the URL — a replacement is a new
  // URL, so a stale one is never served.
  res.set("Cache-Control", "private, max-age=604800");
  res.type(row.photo_mime);
  fsSync.createReadStream(abs).pipe(res);
}

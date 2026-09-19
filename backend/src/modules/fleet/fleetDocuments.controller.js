/**
 * The paperwork behind a fleet record: licences, certificates and receipts.
 *
 * Three records used to describe a document without being able to hold one — a
 * driver's licence, a compliance certificate, a maintenance receipt. This is
 * the office side of all three. The driver app uploads its own licence through
 * driverProfile.controller.js; both write the same columns.
 *
 * Every read and write is scoped to the caller's company. A licence is a
 * photograph of a person and a receipt is a financial record, so none of this
 * is ever served from a static directory — the file is streamed only after the
 * row it belongs to has been matched against the company asking for it.
 */
import fsSync from "node:fs";
import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { toRelative, toAbsolute, discard } from "../finance/receipts.storage.js";

/**
 * Stream a stored file, or say plainly that it is missing.
 *
 * A row pointing at a file that is not on disk is its own kind of problem —
 * usually a volume that was not mounted — and reporting it as "not found"
 * rather than crashing keeps the rest of the screen working.
 */
function sendFile(res, { storagePath, mime, fileName, download = false }) {
  const abs = toAbsolute(storagePath);
  if (!fsSync.existsSync(abs)) {
    return res.status(404).json({ success: false, message: "The file is missing from storage." });
  }
  res.type(mime || "application/octet-stream");
  if (fileName) {
    res.setHeader(
      "Content-Disposition",
      `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(fileName)}"`
    );
  }
  return fsSync.createReadStream(abs).pipe(res);
}

/** Replace a file a row already points at, without losing either. */
async function supersede(previousPath) {
  if (!previousPath) return;
  try {
    discard(toAbsolute(previousPath));
  } catch {
    /* already gone, or outside the root — nothing to clean up */
  }
}

/* ---------------------------------------------------------------- */
/* Driver licence                                                   */
/* ---------------------------------------------------------------- */

export async function driverLicensePhoto(req, res) {
  const { companyId } = req.context;
  const [[d]] = await db.execute(
    `SELECT license_photo_path, license_photo_mime, license_no
       FROM drivers WHERE driver_id = ? AND company_id = ? LIMIT 1`,
    [Number(req.params.id), companyId]
  );
  if (!d) return res.status(404).json({ success: false, message: "Driver not found." });
  if (!d.license_photo_path) {
    return res.status(404).json({ success: false, message: "No licence photo on file." });
  }
  // Private: this is a photograph of an identity document.
  res.set("Cache-Control", "private, max-age=86400");
  return sendFile(res, {
    storagePath: d.license_photo_path,
    mime: d.license_photo_mime,
    fileName: `licence-${d.license_no || req.params.id}`,
  });
}

export async function uploadDriverLicensePhoto(req, res) {
  const { companyId } = req.context;
  const driverId = Number(req.params.id);
  const file = req.file || null;

  if (!file) return res.status(400).json({ success: false, message: "No licence photo was attached." });

  const [[existing]] = await db.execute(
    `SELECT license_photo_path FROM drivers WHERE driver_id = ? AND company_id = ? LIMIT 1`,
    [driverId, companyId]
  );
  if (!existing) {
    discard(file.path);
    return res.status(404).json({ success: false, message: "Driver not found." });
  }

  try {
    await db.execute(
      `UPDATE drivers
          SET license_photo_path = ?, license_photo_mime = ?, license_photo_size = ?,
              license_photo_updated_at = NOW(), license_photo_by_driver = 0
        WHERE driver_id = ? AND company_id = ?`,
      [toRelative(file.path), file.mimetype, file.size, driverId, companyId]
    );
  } catch (error) {
    // The row never took the new file, so the new file is litter.
    discard(file.path);
    throw error;
  }

  // Only once the row points at the new one. A crash between the two leaves an
  // orphaned file, which is harmless; the other order loses the licence.
  await supersede(existing.license_photo_path);

  await recordAudit(req, {
    module: "fleet",
    action: "driver.license_photo.upload",
    entityType: "driver",
    entityId: driverId,
    summary: `Uploaded licence photo for driver ${driverId}`,
  });

  res.json({ success: true, message: "Licence photo saved." });
}

export async function removeDriverLicensePhoto(req, res) {
  const { companyId } = req.context;
  const driverId = Number(req.params.id);

  const [[d]] = await db.execute(
    `SELECT license_photo_path FROM drivers WHERE driver_id = ? AND company_id = ? LIMIT 1`,
    [driverId, companyId]
  );
  if (!d) return res.status(404).json({ success: false, message: "Driver not found." });

  await db.execute(
    `UPDATE drivers
        SET license_photo_path = NULL, license_photo_mime = NULL, license_photo_size = NULL,
            license_photo_updated_at = NOW(), license_photo_by_driver = 0
      WHERE driver_id = ? AND company_id = ?`,
    [driverId, companyId]
  );
  await supersede(d.license_photo_path);

  await recordAudit(req, {
    module: "fleet",
    action: "driver.license_photo.remove",
    entityType: "driver",
    entityId: driverId,
    summary: `Removed licence photo for driver ${driverId}`,
  });

  res.json({ success: true, message: "Licence photo removed." });
}

/* ---------------------------------------------------------------- */
/* Maintenance receipts                                             */
/* ---------------------------------------------------------------- */

const KINDS = ["receipt", "invoice", "quote", "warranty", "photo", "other"];

const shapeAttachment = (r) => ({
  id: r.attachment_id,
  maintenanceId: r.maintenance_id,
  kind: r.kind,
  fileName: r.file_name,
  mimeType: r.mime_type,
  byteSize: Number(r.byte_size),
  note: r.note,
  createdAt: r.created_at,
});

/** The job, if it belongs to the company asking. */
async function ownedJob(maintenanceId, companyId) {
  const [[row]] = await db.execute(
    `SELECT m.maintenance_id, v.plate_no
       FROM vehicle_maintenance m
       JOIN vehicles v ON v.vehicle_id = m.vehicle_id
      WHERE m.maintenance_id = ? AND m.company_id = ? LIMIT 1`,
    [maintenanceId, companyId]
  );
  return row || null;
}

export async function listMaintenanceAttachments(req, res) {
  const { companyId } = req.context;
  const maintenanceId = Number(req.params.id);

  if (!(await ownedJob(maintenanceId, companyId))) {
    return res.status(404).json({ success: false, message: "Maintenance record not found." });
  }

  const [rows] = await db.execute(
    `SELECT * FROM maintenance_attachments
      WHERE maintenance_id = ? AND company_id = ?
      ORDER BY attachment_id DESC`,
    [maintenanceId, companyId]
  );
  res.json({ success: true, data: rows.map(shapeAttachment) });
}

export async function uploadMaintenanceAttachment(req, res) {
  const { companyId, userId } = req.context;
  const maintenanceId = Number(req.params.id);
  const file = req.file || null;

  if (!file) return res.status(400).json({ success: false, message: "No file was attached." });

  const job = await ownedJob(maintenanceId, companyId);
  if (!job) {
    discard(file.path);
    return res.status(404).json({ success: false, message: "Maintenance record not found." });
  }

  const kind = KINDS.includes(req.body.kind) ? req.body.kind : "receipt";
  const note = String(req.body.note || "").trim().slice(0, 255) || null;

  let insertId;
  try {
    const [r] = await db.execute(
      `INSERT INTO maintenance_attachments
         (maintenance_id, company_id, kind, file_name, mime_type, byte_size, storage_path, note, uploaded_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        maintenanceId,
        companyId,
        kind,
        String(file.originalname || "receipt").slice(0, 255),
        file.mimetype,
        file.size,
        toRelative(file.path),
        note,
        userId || null,
      ]
    );
    insertId = r.insertId;
  } catch (error) {
    discard(file.path);
    throw error;
  }

  await recordAudit(req, {
    module: "fleet",
    action: "maintenance.attachment.upload",
    entityType: "vehicle_maintenance",
    entityId: maintenanceId,
    summary: `Attached a ${kind} to maintenance on ${job.plate_no}`,
  });

  res.status(201).json({ success: true, data: { id: insertId, kind } });
}

export async function serveMaintenanceAttachment(req, res) {
  const { companyId } = req.context;
  const [[a]] = await db.execute(
    `SELECT storage_path, mime_type, file_name FROM maintenance_attachments
      WHERE attachment_id = ? AND company_id = ? LIMIT 1`,
    [Number(req.params.attachmentId), companyId]
  );
  if (!a) return res.status(404).json({ success: false, message: "Attachment not found." });

  return sendFile(res, {
    storagePath: a.storage_path,
    mime: a.mime_type,
    fileName: a.file_name,
    download: String(req.query.download || "") === "1",
  });
}

export async function removeMaintenanceAttachment(req, res) {
  const { companyId } = req.context;
  const attachmentId = Number(req.params.attachmentId);

  const [[a]] = await db.execute(
    `SELECT storage_path, maintenance_id, kind FROM maintenance_attachments
      WHERE attachment_id = ? AND company_id = ? LIMIT 1`,
    [attachmentId, companyId]
  );
  if (!a) return res.status(404).json({ success: false, message: "Attachment not found." });

  await db.execute(
    `DELETE FROM maintenance_attachments WHERE attachment_id = ? AND company_id = ?`,
    [attachmentId, companyId]
  );
  await supersede(a.storage_path);

  await recordAudit(req, {
    module: "fleet",
    action: "maintenance.attachment.remove",
    entityType: "vehicle_maintenance",
    entityId: a.maintenance_id,
    summary: `Removed a ${a.kind} from maintenance record ${a.maintenance_id}`,
  });

  res.json({ success: true, message: "Attachment removed." });
}

/* ---------------------------------------------------------------- */
/* Compliance documents                                             */
/* ---------------------------------------------------------------- */

/*
 * A compliance_documents row is one document — a registration, an insurance
 * certificate — so its file belongs on the row rather than in a list beside it.
 * Uploading again replaces what was there, which is what renewing a
 * certificate means.
 */

async function ownedDocument(documentId, companyId) {
  const [[row]] = await db.execute(
    `SELECT document_id, doc_type, file_path, file_name, file_mime
       FROM compliance_documents
      WHERE document_id = ? AND company_id = ? LIMIT 1`,
    [documentId, companyId]
  );
  return row || null;
}

export async function uploadComplianceFile(req, res) {
  const { companyId, userId } = req.context;
  const documentId = Number(req.params.id);
  const file = req.file || null;

  if (!file) return res.status(400).json({ success: false, message: "No document was attached." });

  const doc = await ownedDocument(documentId, companyId);
  if (!doc) {
    discard(file.path);
    return res.status(404).json({ success: false, message: "Document not found." });
  }

  try {
    await db.execute(
      `UPDATE compliance_documents
          SET file_path = ?, file_name = ?, file_mime = ?, file_size = ?,
              file_uploaded_at = NOW(), file_uploaded_by = ?
        WHERE document_id = ? AND company_id = ?`,
      [
        toRelative(file.path),
        String(file.originalname || doc.doc_type).slice(0, 255),
        file.mimetype,
        file.size,
        userId || null,
        documentId,
        companyId,
      ]
    );
  } catch (error) {
    discard(file.path);
    throw error;
  }

  await supersede(doc.file_path);

  await recordAudit(req, {
    module: "fleet",
    action: "compliance.document.file.upload",
    entityType: "compliance_document",
    entityId: documentId,
    summary: `Attached a file to the ${doc.doc_type} document`,
  });

  res.json({ success: true, message: "Document saved." });
}

export async function serveComplianceFile(req, res) {
  const { companyId } = req.context;
  const doc = await ownedDocument(Number(req.params.id), companyId);
  if (!doc) return res.status(404).json({ success: false, message: "Document not found." });
  if (!doc.file_path) {
    return res.status(404).json({ success: false, message: "No file has been attached to this document." });
  }

  return sendFile(res, {
    storagePath: doc.file_path,
    mime: doc.file_mime,
    fileName: doc.file_name || doc.doc_type,
    download: String(req.query.download || "") === "1",
  });
}

export async function removeComplianceFile(req, res) {
  const { companyId } = req.context;
  const documentId = Number(req.params.id);

  const doc = await ownedDocument(documentId, companyId);
  if (!doc) return res.status(404).json({ success: false, message: "Document not found." });

  await db.execute(
    `UPDATE compliance_documents
        SET file_path = NULL, file_name = NULL, file_mime = NULL, file_size = NULL,
            file_uploaded_at = NULL, file_uploaded_by = NULL
      WHERE document_id = ? AND company_id = ?`,
    [documentId, companyId]
  );
  await supersede(doc.file_path);

  await recordAudit(req, {
    module: "fleet",
    action: "compliance.document.file.remove",
    entityType: "compliance_document",
    entityId: documentId,
    summary: `Removed the file from the ${doc.doc_type} document`,
  });

  res.json({ success: true, message: "File removed." });
}

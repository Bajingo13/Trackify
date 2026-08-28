import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";

const NUM = (v) => (v === "" || v == null ? null : Number(v));
const STR = (v) => (v === "" || v == null ? null : String(v).trim());

/**
 * GET /api/v1/fleet/compliance
 * One feed of everything with an expiry date — driver licences, vehicle
 * registration & insurance, and any extra compliance_documents — each with
 * days-to-expiry and a derived status.
 */
export async function listCompliance(req, res) {
  const { companyId } = req.context;
  const withinDays = Math.min(365, Math.max(1, Number(req.query.withinDays) || 90));

  const [rows] = await db.execute(
    `
    SELECT * FROM (
      SELECT 'driver' AS entity_type, d.driver_id AS entity_id,
             CONCAT(d.first_name, ' ', d.last_name) AS entity_label,
             'Driver Licence' AS doc_type, d.license_no AS doc_number, d.license_expiry AS expiry_date
      FROM drivers d WHERE d.company_id = ? AND d.status <> 'inactive' AND d.license_expiry IS NOT NULL

      UNION ALL
      SELECT 'vehicle', v.vehicle_id, v.plate_no, 'Registration (OR/CR)', NULL, v.registration_expiry
      FROM vehicles v WHERE v.company_id = ? AND v.status <> 'inactive' AND v.registration_expiry IS NOT NULL

      UNION ALL
      SELECT 'vehicle', v.vehicle_id, v.plate_no, 'Insurance', NULL, v.insurance_expiry
      FROM vehicles v WHERE v.company_id = ? AND v.status <> 'inactive' AND v.insurance_expiry IS NOT NULL

      UNION ALL
      SELECT cd.entity_type, cd.entity_id,
             CASE cd.entity_type
               WHEN 'driver' THEN (SELECT CONCAT(first_name,' ',last_name) FROM drivers WHERE driver_id = cd.entity_id)
               ELSE (SELECT plate_no FROM vehicles WHERE vehicle_id = cd.entity_id)
             END,
             cd.doc_type, cd.doc_number, cd.expiry_date
      FROM compliance_documents cd WHERE cd.company_id = ? AND cd.expiry_date IS NOT NULL
    ) x
    ORDER BY x.expiry_date ASC
    `,
    [companyId, companyId, companyId, companyId]
  );

  const today = new Date();
  const data = rows.map((r) => {
    const exp = new Date(r.expiry_date);
    const days = Math.round((exp - today) / 86400000);
    return {
      ...r,
      days_to_expiry: days,
      compliance_status: days < 0 ? "expired" : days <= 30 ? "expiring" : "valid",
    };
  });

  const withinWindow = data.filter((d) => d.days_to_expiry <= withinDays);
  res.json({
    success: true,
    data: withinWindow,
    stats: {
      tracked: data.length,
      expired: data.filter((d) => d.compliance_status === "expired").length,
      expiring: data.filter((d) => d.compliance_status === "expiring").length,
      valid: data.filter((d) => d.compliance_status === "valid").length,
    },
  });
}

/** POST /api/v1/fleet/compliance/documents — record an extra document. */
export async function createComplianceDocument(req, res) {
  const { companyId } = req.context;
  const b = req.body;
  const entityType = b.entityType === "vehicle" ? "vehicle" : "driver";
  const entityId = NUM(b.entityId);
  const docType = STR(b.docType);

  if (!entityId || !docType) {
    return res.status(400).json({ success: false, message: "Entity and document type are required." });
  }

  const table = entityType === "vehicle" ? "vehicles" : "drivers";
  const idCol = entityType === "vehicle" ? "vehicle_id" : "driver_id";
  const [owner] = await db.execute(
    `SELECT ${idCol} FROM ${table} WHERE ${idCol} = ? AND company_id = ? LIMIT 1`,
    [entityId, companyId]
  );
  if (!owner.length) {
    return res.status(400).json({ success: false, message: `Invalid ${entityType}.` });
  }

  const [result] = await db.execute(
    `INSERT INTO compliance_documents
       (company_id, entity_type, entity_id, doc_type, doc_number, issue_date, expiry_date, reference, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId, entityType, entityId, docType, STR(b.docNumber),
      STR(b.issueDate), STR(b.expiryDate), STR(b.reference), STR(b.notes), req.context.userId,
    ]
  );

  await recordAudit(req, {
    module: "fleet", action: "compliance.document.create", entityType: `${entityType}`, entityId,
    summary: `Recorded ${docType} for ${entityType} #${entityId}`,
  });

  res.status(201).json({ success: true, data: { documentId: result.insertId } });
}

import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { STR, money, ok, fail, pageParams, runList } from "./_shared.js";

const DOC_TYPES = ["official_receipt", "sales_invoice", "form_2307", "form_2306", "sales_book", "purchase_book"];

const mapRow = (r) => ({
  id: r.record_id,
  docType: r.doc_type,
  docNo: r.doc_no,
  docDate: r.doc_date,
  partyName: r.party_name,
  tin: r.tin,
  grossAmount: Number(r.gross_amount),
  taxAmount: Number(r.tax_amount),
  description: r.description,
  status: r.status,
  filedAt: r.filed_at,
  createdAt: r.created_at,
});

export async function listRecords(req, res) {
  const { companyId } = req.context;
  const { docType, status, search, from, to } = req.query;
  const where = ["company_id = ?"];
  const params = [companyId];
  if (docType) { where.push("doc_type = ?"); params.push(docType); }
  if (status) { where.push("status = ?"); params.push(status); }
  if (from) { where.push("doc_date >= ?"); params.push(from); }
  if (to) { where.push("doc_date <= ?"); params.push(to); }
  if (search) { where.push("(doc_no LIKE ? OR party_name LIKE ? OR tin LIKE ?)"); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const { limit, offset, page } = pageParams(req.query);
  const { rows, total } = await runList(db, {
    selectSql: "SELECT *",
    fromWhereSql: `FROM bir_records WHERE ${where.join(" AND ")}`,
    orderSql: "ORDER BY doc_date DESC, record_id DESC",
    params, limit, offset,
  });
  ok(res, rows.map(mapRow), limit == null ? {} : { pagination: { total, page, limit } });
}

export async function recordStats(req, res) {
  const { companyId } = req.context;
  const [[s]] = await db.execute(
    `SELECT
        COUNT(*) total,
        COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) active,
        COALESCE(SUM(CASE WHEN status = 'filed' THEN 1 ELSE 0 END), 0) filed,
        COALESCE(SUM(tax_amount), 0) taxTotal
       FROM bir_records WHERE company_id = ?`,
    [companyId]
  );
  const [byType] = await db.execute(
    "SELECT doc_type, COUNT(*) count, COALESCE(SUM(tax_amount),0) tax FROM bir_records WHERE company_id = ? GROUP BY doc_type",
    [companyId]
  );
  ok(res, {
    total: Number(s.total), active: Number(s.active), filed: Number(s.filed), taxTotal: Number(s.taxTotal),
    byType: byType.map((r) => ({ docType: r.doc_type, count: Number(r.count), tax: Number(r.tax) })),
  });
}

export async function createRecord(req, res) {
  const { companyId, userId } = req.context;
  const b = req.body;
  if (!DOC_TYPES.includes(b.docType)) return fail(res, 400, "Pick a valid document type.");
  const docNo = STR(b.docNo);
  const docDate = STR(b.docDate);
  if (!docNo || !docDate) return fail(res, 400, "Document number and date are required.");
  const [r] = await db.execute(
    `INSERT INTO bir_records (company_id, doc_type, doc_no, doc_date, party_name, tin, gross_amount, tax_amount, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [companyId, b.docType, docNo, docDate, STR(b.partyName), STR(b.tin), money(b.grossAmount), money(b.taxAmount), STR(b.description), userId]
  );
  await recordAudit(req, { module: "finance", action: "bir.create", entityType: "bir_record", entityId: r.insertId, summary: `Registered ${b.docType} ${docNo}` });
  res.status(201).json({ success: true, message: "Record added.", data: { id: r.insertId } });
}

export async function updateRecord(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const [[row]] = await db.execute("SELECT status FROM bir_records WHERE record_id = ? AND company_id = ? LIMIT 1", [id, companyId]);
  if (!row) return fail(res, 404, "Record not found.");

  const b = req.body;
  const map = {
    docType: "doc_type", docNo: "doc_no", docDate: "doc_date", partyName: "party_name",
    tin: "tin", grossAmount: "gross_amount", taxAmount: "tax_amount", description: "description",
  };
  const sets = [];
  const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (b[k] === undefined) continue;
    if (k === "docType" && !DOC_TYPES.includes(b[k])) return fail(res, 400, "Invalid document type.");
    sets.push(`${col} = ?`);
    params.push(["grossAmount", "taxAmount"].includes(k) ? money(b[k]) : STR(b[k]));
  }
  if (["active", "filed", "cancelled"].includes(b.status)) {
    sets.push("status = ?"); params.push(b.status);
    if (b.status === "filed") sets.push("filed_at = NOW()");
  }
  if (!sets.length) return fail(res, 400, "Nothing to update.");
  params.push(id);
  await db.execute(`UPDATE bir_records SET ${sets.join(", ")} WHERE record_id = ?`, params);
  await recordAudit(req, { module: "finance", action: "bir.update", entityType: "bir_record", entityId: id, summary: `Updated BIR record #${id}`, metadata: b });
  ok(res, { id });
}

export async function deleteRecord(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);
  const [[row]] = await db.execute("SELECT doc_no FROM bir_records WHERE record_id = ? AND company_id = ? LIMIT 1", [id, companyId]);
  if (!row) return fail(res, 404, "Record not found.");
  await db.execute("DELETE FROM bir_records WHERE record_id = ?", [id]);
  await recordAudit(req, { module: "finance", action: "bir.delete", entityType: "bir_record", entityId: id, summary: `Deleted BIR record ${row.doc_no}` });
  ok(res, { id });
}

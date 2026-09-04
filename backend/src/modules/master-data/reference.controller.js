import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";

const STR = (v) => (v === "" || v == null ? null : String(v).trim());
const NUM = (v) => (v === "" || v == null ? null : Number(v));

/**
 * Small CRUD factory for the "code + name + a few fields + status" master tables
 * (suppliers, chart of accounts, tax codes).
 */
export function makeCrud(cfg) {
  const { table, pk, codeCol, namePayloadKey, nameCol, codePrefix, fields, searchCols, auditKey } = cfg;
  const allCols = [codeCol, nameCol, ...fields.map((f) => f.col), "status"];

  async function nextCode(companyId) {
    const [rows] = await db.execute(
      `SELECT ${codeCol} c FROM ${table}
       WHERE company_id = ? AND ${codeCol} REGEXP ?
       ORDER BY CAST(SUBSTRING(${codeCol}, ${codePrefix.length + 1}) AS UNSIGNED) DESC LIMIT 1`,
      [companyId, `^${codePrefix}[0-9]+$`]
    );
    const last = rows.length ? Number(rows[0].c.slice(codePrefix.length)) : 0;
    return `${codePrefix}${String(last + 1).padStart(4, "0")}`;
  }

  const list = async (req, res) => {
    const { companyId } = req.context;
    const { search = "", status = "" } = req.query;
    const params = [companyId];
    let where = "company_id = ?";
    if (status === "active" || status === "inactive") { where += " AND status = ?"; params.push(status); }
    if (search.trim()) {
      where += " AND (" + searchCols.map((c) => `${c} LIKE ?`).join(" OR ") + ")";
      searchCols.forEach(() => params.push(`%${search.trim()}%`));
    }
    const [rows] = await db.execute(
      `SELECT ${pk}, ${allCols.join(", ")}, created_at, updated_at FROM ${table} WHERE ${where} ORDER BY ${nameCol} ASC`,
      params
    );
    res.json({ success: true, data: rows });
  };

  const create = async (req, res) => {
    const { companyId } = req.context;
    const b = req.body;
    const name = STR(b[namePayloadKey]);
    if (!name) return res.status(400).json({ success: false, message: "Name is required." });

    let code = STR(b.code)?.toUpperCase();
    if (!code) code = await nextCode(companyId);
    else {
      const [[dupe]] = await db.execute(`SELECT ${pk} FROM ${table} WHERE company_id = ? AND ${codeCol} = ? LIMIT 1`, [companyId, code]);
      if (dupe) return res.status(409).json({ success: false, message: "That code already exists." });
    }

    const cols = ["company_id", codeCol, nameCol];
    const vals = [companyId, code, name];
    for (const f of fields) {
      cols.push(f.col);
      vals.push(f.type === "number" ? (NUM(b[f.key]) ?? f.default ?? 0) : (STR(b[f.key]) ?? f.default ?? null));
    }
    const [result] = await db.execute(
      `INSERT INTO ${table} (${cols.join(", ")}, status) VALUES (${cols.map(() => "?").join(", ")}, 'active')`,
      vals
    );
    await recordAudit(req, { module: "master-data", action: `${auditKey}.create`, entityType: auditKey, entityId: result.insertId, summary: `Created ${name}` });
    res.status(201).json({ success: true, message: "Created.", data: { id: result.insertId, code } });
  };

  const update = async (req, res) => {
    const { companyId } = req.context;
    const id = Number(req.params.id);
    const [[row]] = await db.execute(`SELECT ${pk} FROM ${table} WHERE ${pk} = ? AND company_id = ? LIMIT 1`, [id, companyId]);
    if (!row) return res.status(404).json({ success: false, message: "Not found." });

    const b = req.body;
    const sets = [];
    const vals = [];
    if (b[namePayloadKey] !== undefined) { sets.push(`${nameCol} = ?`); vals.push(STR(b[namePayloadKey])); }
    for (const f of fields) {
      if (b[f.key] !== undefined) {
        sets.push(`${f.col} = ?`);
        vals.push(f.type === "number" ? NUM(b[f.key]) : STR(b[f.key]));
      }
    }
    if (b.status === "active" || b.status === "inactive") { sets.push("status = ?"); vals.push(b.status); }
    if (!sets.length) return res.status(400).json({ success: false, message: "Nothing to update." });

    vals.push(id);
    await db.execute(`UPDATE ${table} SET ${sets.join(", ")} WHERE ${pk} = ?`, vals);
    await recordAudit(req, { module: "master-data", action: `${auditKey}.update`, entityType: auditKey, entityId: id, summary: `Updated #${id}`, metadata: b });
    res.json({ success: true });
  };

  return { list, create, update };
}

export const suppliers = makeCrud({
  table: "suppliers", pk: "supplier_id", codeCol: "supplier_code", nameCol: "supplier_name",
  namePayloadKey: "supplierName", codePrefix: "SUP-", auditKey: "supplier",
  searchCols: ["supplier_name", "supplier_code", "contact_person", "email"],
  fields: [
    { key: "contactPerson", col: "contact_person", type: "string" },
    { key: "phone", col: "phone", type: "string" },
    { key: "email", col: "email", type: "string" },
    { key: "address", col: "address", type: "string" },
    { key: "taxId", col: "tax_id", type: "string" },
  ],
});

export const accounts = makeCrud({
  table: "chart_of_accounts", pk: "account_id", codeCol: "account_code", nameCol: "account_name",
  namePayloadKey: "accountName", codePrefix: "ACC-", auditKey: "account",
  searchCols: ["account_name", "account_code"],
  fields: [
    { key: "accountType", col: "account_type", type: "string", default: "expense" },
    { key: "description", col: "description", type: "string" },
  ],
});

export const warehouses = makeCrud({
  table: "warehouses", pk: "warehouse_id", codeCol: "code", nameCol: "name",
  namePayloadKey: "name", codePrefix: "WH-", auditKey: "warehouse",
  searchCols: ["name", "code", "location"],
  fields: [{ key: "location", col: "location", type: "string" }],
});

export const taxCodes = makeCrud({
  table: "tax_codes", pk: "tax_code_id", codeCol: "code", nameCol: "name",
  namePayloadKey: "name", codePrefix: "TAX-", auditKey: "taxcode",
  searchCols: ["name", "code"],
  fields: [
    { key: "rate", col: "rate", type: "number", default: 0 },
    { key: "taxType", col: "tax_type", type: "string", default: "vat" },
  ],
});

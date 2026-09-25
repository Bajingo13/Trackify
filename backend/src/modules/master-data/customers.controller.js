import db from "../../config/db.js";
import { recordAudit } from "../../shared/audit.js";
import { textField, emailField, phoneField, firstProblem } from "../../shared/fieldChecks.js";

/*
 * The column widths, in one place, so the checks and the table cannot drift
 * apart. Anything longer used to reach MySQL and come back as HTTP 500 with
 * "Data too long for column 'customer_name'" — a server error for what is
 * really a correctable typing mistake.
 */
const LIMITS = {
  customerName: 200,
  customerCode: 50,
  contactPerson: 200,
  phone: 50,
  email: 200,
};

/** Everything checkable about a customer, in the order a form asks for it. */
function customerProblem(body, { requireName = true } = {}) {
  return firstProblem(
    textField(body.customerName, { label: "Customer name", max: LIMITS.customerName, required: requireName }),
    textField(body.customerCode, { label: "Customer code", max: LIMITS.customerCode }),
    textField(body.contactPerson, { label: "Contact person", max: LIMITS.contactPerson }),
    phoneField(body.phone, { max: LIMITS.phone }),
    emailField(body.email, { max: LIMITS.email })
  );
}

/* GET /api/v1/master-data/customers  (also mounted at /api/v1/customers) */
export async function listCustomers(req, res) {
  const { companyId } = req.context;
  const { search = "", status = "" } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const params = [companyId];
  let where = "c.company_id = ?";

  if (status === "active" || status === "inactive") {
    where += " AND c.status = ?";
    params.push(status);
  } else {
    where += " AND c.status <> 'archived'";
  }

  if (search.trim()) {
    where += " AND (c.customer_name LIKE ? OR c.customer_code LIKE ? OR c.contact_person LIKE ?)";
    const v = `%${search.trim()}%`;
    params.push(v, v, v);
  }

  const [countRows] = await db.execute(
    `SELECT COUNT(*) AS total FROM customers c WHERE ${where}`,
    params
  );
  const total = countRows[0].total;

  const [rows] = await db.execute(
    `SELECT c.customer_id, c.customer_code, c.customer_name, c.contact_person,
            c.phone, c.email, c.address, c.status, c.created_at, c.updated_at
     FROM customers c
     WHERE ${where}
     ORDER BY c.customer_name ASC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  res.json({
    success: true,
    data: rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

/* Kept for the operations customer picker (expects a plain array in res.data). */
export const searchCustomers = listCustomers;

/* GET .../customers/:id */
export async function getCustomer(req, res) {
  const { companyId } = req.context;
  const customerId = Number(req.params.id);

  const [rows] = await db.execute(
    `SELECT c.customer_id, c.customer_code, c.customer_name, c.contact_person,
            c.phone, c.email, c.address, c.status, c.created_at, c.updated_at
     FROM customers c
     WHERE c.customer_id = ? AND c.company_id = ? LIMIT 1`,
    [customerId, companyId]
  );

  if (!rows.length) {
    return res.status(404).json({ success: false, message: "Customer not found." });
  }

  res.json({ success: true, data: rows[0] });
}

async function nextCustomerCode(companyId) {
  const [rows] = await db.execute(
    `SELECT customer_code FROM customers
     WHERE company_id = ? AND customer_code REGEXP '^CUS-[0-9]+$'
     ORDER BY CAST(SUBSTRING(customer_code, 5) AS UNSIGNED) DESC LIMIT 1`,
    [companyId]
  );
  const last = rows.length ? Number(rows[0].customer_code.slice(4)) : 0;
  return `CUS-${String(last + 1).padStart(4, "0")}`;
}

/* POST .../customers */
export async function createCustomer(req, res) {
  const { companyId } = req.context;
  const customerName = String(req.body.customerName || "").trim();
  const contactPerson = req.body.contactPerson ? String(req.body.contactPerson).trim() : null;
  const phone = req.body.phone ? String(req.body.phone).trim() : null;
  const email = req.body.email ? String(req.body.email).trim() : null;
  const address = req.body.address ? String(req.body.address).trim() : null;
  let customerCode = req.body.customerCode ? String(req.body.customerCode).trim().toUpperCase() : "";

  const problem = customerProblem(req.body);
  if (problem) {
    return res.status(400).json({ success: false, message: problem });
  }

  if (!customerCode) {
    customerCode = await nextCustomerCode(companyId);
  } else {
    const [dupe] = await db.execute(
      "SELECT customer_id FROM customers WHERE company_id = ? AND customer_code = ? LIMIT 1",
      [companyId, customerCode]
    );
    if (dupe.length) {
      return res.status(409).json({ success: false, message: "Customer code already exists." });
    }
  }

  const [result] = await db.execute(
    `INSERT INTO customers (company_id, customer_code, customer_name, contact_person, phone, email, address, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
    [companyId, customerCode, customerName, contactPerson, phone, email, address]
  );

  await recordAudit(req, {
    module: "master-data",
    action: "customer.create",
    entityType: "customer",
    entityId: result.insertId,
    summary: `Created customer ${customerName} (${customerCode})`,
  });

  res.status(201).json({ success: true, data: { customerId: result.insertId, customerCode } });
}

/* PATCH .../customers/:id */
export async function updateCustomer(req, res) {
  const { companyId } = req.context;
  const id = Number(req.params.id);

  const [existing] = await db.execute(
    "SELECT customer_id FROM customers WHERE customer_id = ? AND company_id = ? LIMIT 1",
    [id, companyId]
  );
  if (!existing.length) {
    return res.status(404).json({ success: false, message: "Customer not found." });
  }

  /* An edit is checked the same way a creation is. Only the fields actually
   * being sent are required to be present, so a caller changing one thing is
   * not asked for the rest. */
  const problem = customerProblem(req.body, { requireName: req.body.customerName !== undefined });
  if (problem) {
    return res.status(400).json({ success: false, message: problem });
  }

  const map = {
    customerName: "customer_name",
    contactPerson: "contact_person",
    phone: "phone",
    email: "email",
    address: "address",
  };

  const fields = [];
  const params = [];
  for (const [key, column] of Object.entries(map)) {
    if (req.body[key] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(req.body[key] === "" ? null : String(req.body[key]).trim());
    }
  }
  if (req.body.status === "active" || req.body.status === "inactive") {
    fields.push("status = ?");
    params.push(req.body.status);
  }

  if (!fields.length) {
    return res.status(400).json({ success: false, message: "Nothing to update." });
  }

  params.push(id);
  await db.execute(`UPDATE customers SET ${fields.join(", ")} WHERE customer_id = ?`, params);

  await recordAudit(req, {
    module: "master-data",
    action: "customer.update",
    entityType: "customer",
    entityId: id,
    summary: `Updated customer #${id}`,
    metadata: req.body,
  });

  res.json({ success: true });
}

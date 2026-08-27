import db from "../../config/db.js";

export async function searchCustomers(req, res) {
  const { companyId } = req.context;
  const { search = "" } = req.query;

  const params = [companyId];
  let whereSql = "c.company_id = ? AND c.status = 'active'";

  if (search.trim()) {
    const value = `%${search.trim()}%`;
    whereSql += " AND (c.customer_name LIKE ? OR c.customer_code LIKE ?)";
    params.push(value, value);
  }

  const [rows] = await db.execute(
    `SELECT c.customer_id, c.customer_code, c.customer_name, c.contact_person, c.phone, c.email, c.address
     FROM customers c WHERE ${whereSql} ORDER BY c.customer_name ASC LIMIT 50`,
    params
  );

  res.json({ success: true, data: rows });
}

export async function getCustomer(req, res) {
  const { companyId } = req.context;
  const customerId = Number(req.params.id);

  const [rows] = await db.execute(
    `SELECT c.customer_id, c.customer_code, c.customer_name, c.contact_person, c.phone, c.email, c.address
     FROM customers c WHERE c.customer_id = ? AND c.company_id = ? AND c.status = 'active' LIMIT 1`,
    [customerId, companyId]
  );

  if (!rows.length) {
    return res.status(404).json({ success: false, message: "Customer not found." });
  }

  res.json({ success: true, data: rows[0] });
}

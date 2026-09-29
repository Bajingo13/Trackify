/**
 * 041 — A fuller client profile.
 *
 * New Client Setup used to record a company as a name and a code. Managing a
 * client needs more: who they legally are (trade name, business type, TIN),
 * how to reach them (email, phone, a primary contact), where they are
 * (registered address), and the commercial basics (billing email, payment
 * terms, contract start). The first branch gains an address and a phone.
 *
 * Every column is nullable: existing companies stay valid, and the setup form
 * keeps only the name and code mandatory.
 *
 * Idempotent.
 */
const COMPANY = [
  ["trade_name", "VARCHAR(200) NULL"],
  ["business_type", "VARCHAR(40) NULL"],
  ["industry", "VARCHAR(60) NULL"],
  ["tin", "VARCHAR(20) NULL"],
  ["fleet_size", "INT UNSIGNED NULL"],
  ["email", "VARCHAR(200) NULL"],
  ["phone", "VARCHAR(40) NULL"],
  ["website", "VARCHAR(200) NULL"],
  ["contact_name", "VARCHAR(150) NULL"],
  ["contact_position", "VARCHAR(100) NULL"],
  ["contact_phone", "VARCHAR(40) NULL"],
  ["address_line", "VARCHAR(255) NULL"],
  ["barangay", "VARCHAR(120) NULL"],
  ["city", "VARCHAR(120) NULL"],
  ["province", "VARCHAR(120) NULL"],
  ["postal_code", "VARCHAR(10) NULL"],
  ["country", "VARCHAR(80) NULL"],
  ["billing_email", "VARCHAR(200) NULL"],
  ["payment_terms", "VARCHAR(30) NULL"],
  ["contract_start", "DATE NULL"],
  ["notes", "VARCHAR(1000) NULL"],
];

const BRANCH = [
  ["address_line", "VARCHAR(255) NULL"],
  ["city", "VARCHAR(120) NULL"],
  ["province", "VARCHAR(120) NULL"],
  ["postal_code", "VARCHAR(10) NULL"],
  ["contact_number", "VARCHAR(40) NULL"],
];

async function addColumns(conn, table, columns) {
  const [existing] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  const have = new Set(existing.map((row) => row.COLUMN_NAME));
  for (const [name, type] of columns) {
    if (have.has(name)) continue;
    // eslint-disable-next-line no-await-in-loop
    await conn.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

export async function up(conn) {
  await addColumns(conn, "companies", COMPANY);
  await addColumns(conn, "branches", BRANCH);
}

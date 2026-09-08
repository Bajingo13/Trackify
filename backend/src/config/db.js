import mysql from "mysql2/promise";

/**
 * Fail clearly (at startup) when required database configuration is missing,
 * instead of surfacing a confusing runtime error on the first query.
 */
const required = {
  host: process.env.DB_HOST || process.env.MYSQLHOST,
  user: process.env.DB_USER || process.env.MYSQLUSER,
  database: process.env.DB_NAME || process.env.MYSQLDATABASE,
};
const missing = Object.entries(required)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missing.length > 0) {
  console.error(
    `[db] Missing database configuration: ${missing.join(", ")}.\n` +
      `     Set DB_* variables (or Railway's MYSQL* equivalents).`
  );
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || process.env.MYSQLHOST,
  port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
  user: process.env.DB_USER || process.env.MYSQLUSER,
  password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD,
  database: process.env.DB_NAME || process.env.MYSQLDATABASE,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  decimalNumbers: true,
  // Return DATE columns (day-only, no time) as literal 'YYYY-MM-DD' strings so a
  // calendar date is never shifted by the server or client timezone. DATETIME /
  // TIMESTAMP columns still come back as Date objects (real instants in time).
  dateStrings: ["DATE"],
});

/**
 * Verify the pool can reach MySQL. Returns true on success; on failure logs a
 * short reason (never the password) and returns false.
 */
export async function verifyConnection() {
  try {
    const conn = await pool.getConnection();
    await conn.query("SELECT 1");
    conn.release();
    return true;
  } catch (error) {
    console.error(`[db] Database connection failed: ${error.code || error.message}`);
    return false;
  }
}

export default pool;

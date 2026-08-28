import mysql from "mysql2/promise";

/**
 * Fail clearly (at startup) when required database configuration is missing,
 * instead of surfacing a confusing runtime error on the first query.
 */
const REQUIRED_ENV = ["DB_HOST", "DB_USER", "DB_NAME"];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(
    `[db] Missing required environment variable(s): ${missing.join(", ")}.\n` +
      `     Copy .env.example to .env and fill in the values.`
  );
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  decimalNumbers: true,
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

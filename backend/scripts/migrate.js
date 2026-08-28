/**
 * AstreaBlue Trackify — migration runner
 *
 * Applies every backend/migrations/*.sql and *.js file exactly once, in
 * filename order, tracking applied files in a `schema_migrations` table.
 * A .js migration exports `async function up(connection)`.
 *
 *   npm run db:migrate
 *
 * Safe to rerun: already-applied files are skipped. It never drops databases,
 * tables, or truncates data.
 */
import "../src/config/env.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

const {
  DB_HOST,
  DB_PORT = "3306",
  DB_USER,
  DB_PASSWORD = "",
  DB_NAME,
} = process.env;

if (!DB_HOST || !DB_USER || !DB_NAME) {
  console.error("[migrate] Missing DB_HOST, DB_USER or DB_NAME. Configure .env first.");
  process.exit(1);
}

async function main() {
  const connOpts = {
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    multipleStatements: true,
  };

  // Connect straight to the target schema. If it doesn't exist yet, try to
  // create it (needs a privileged user); a scoped app user like trackify_dev
  // will already have the DB provisioned by the DBA.
  let conn;
  try {
    conn = await mysql.createConnection({ ...connOpts, database: DB_NAME });
  } catch (error) {
    if (error.code !== "ER_BAD_DB_ERROR") throw error;
    console.log(`[migrate] Database ${DB_NAME} not found — attempting to create it`);
    conn = await mysql.createConnection(connOpts);
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await conn.changeUser({ database: DB_NAME });
  }
  console.log(`[migrate] Database: ${DB_NAME}`);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  const [applied] = await conn.query("SELECT filename FROM schema_migrations");
  const appliedSet = new Set(applied.map((r) => r.filename));

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql") || f.endsWith(".js"))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`[migrate] skip   ${file} (already applied)`);
      continue;
    }

    const full = path.join(MIGRATIONS_DIR, file);
    console.log(`[migrate] apply  ${file}`);
    try {
      if (file.endsWith(".js")) {
        const mod = await import(pathToFileURL(full).href);
        if (typeof mod.up !== "function") {
          throw new Error("migration must export `async function up(connection)`");
        }
        await mod.up(conn);
      } else {
        await conn.query(await fs.readFile(full, "utf8"));
      }
      await conn.query("INSERT INTO schema_migrations (filename) VALUES (?)", [file]);
      ran++;
    } catch (error) {
      console.error(`[migrate] FAILED ${file}: ${error.message}`);
      await conn.end();
      process.exit(1);
    }
  }

  console.log(`[migrate] Done. ${ran} migration(s) applied, ${files.length - ran} skipped.`);
  await conn.end();
}

main().catch((error) => {
  console.error(`[migrate] Error: ${error.code || error.message}`);
  process.exit(1);
});

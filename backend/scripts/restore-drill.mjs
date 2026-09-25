/**
 * Restores a Trackify backup into an isolated scratch database and proves that
 * both the SQL dump and the copied evidence files are readable.
 *
 *   npm run db:restore-drill -- --dump D:/backups/trackify-....sql \
 *     --files D:/backups/trackify-....-files
 *
 * Remote database hosts are refused unless --allow-remote is supplied. The
 * scratch database always has a generated, tightly validated name and is
 * dropped in finally, so this script cannot target the configured application
 * database by mistake.
 */
import "../src/config/env.js"
import mysql from "mysql2/promise"
import { randomUUID } from "node:crypto"
import { createReadStream, existsSync } from "node:fs"
import { cp, mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

const valueOf = (flag) => {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : null
}

const dumpFile = valueOf("--dump")
const filesBackup = valueOf("--files")
const allowRemote = process.argv.includes("--allow-remote")
const keepDatabase = process.argv.includes("--keep")
const host = process.env.DB_HOST || process.env.MYSQLHOST || "localhost"
const port = Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306)
const user = process.env.DB_USER || process.env.MYSQLUSER
const password = process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || ""
const sourceDatabase = process.env.DB_NAME || process.env.MYSQLDATABASE
const localHosts = new Set(["localhost", "127.0.0.1", "::1"])

function fail(message) {
  console.error(`\n  Restore drill stopped: ${message}\n`)
  process.exit(1)
}

if (!dumpFile) fail("pass the SQL backup with --dump <file>.")
if (!existsSync(dumpFile)) fail(`the dump does not exist: ${dumpFile}`)
if (filesBackup && !existsSync(filesBackup)) fail(`the files backup does not exist: ${filesBackup}`)
if (!user || !sourceDatabase) fail("database credentials are incomplete; check the root .env file.")
if (!localHosts.has(host.toLowerCase()) && !allowRemote) {
  fail("the configured database is remote. Use a non-production database, or pass --allow-remote deliberately.")
}

function findMysql() {
  if (process.env.MYSQL_PATH) return process.env.MYSQL_PATH
  const candidates = [
    "C:/Program Files/MySQL/MySQL Server 8.0/bin/mysql.exe",
    "C:/Program Files/MySQL/MySQL Server 8.4/bin/mysql.exe",
    "/usr/bin/mysql",
    "/usr/local/bin/mysql",
  ]
  return candidates.find(existsSync) || "mysql"
}

async function inventory(directory) {
  let files = 0
  let bytes = 0
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else {
        const details = await stat(full)
        files += 1
        bytes += details.size
      }
    }
  }
  await walk(directory)
  return { files, bytes }
}

function restoreSql(mysqlBinary, scratchDatabase) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      mysqlBinary,
      [
        `--host=${host}`,
        `--port=${port}`,
        `--user=${user}`,
        "--default-character-set=utf8mb4",
        scratchDatabase,
      ],
      { env: { ...process.env, MYSQL_PWD: password } },
    )
    let stderr = ""
    child.stderr.on("data", (chunk) => {
      const message = chunk.toString()
      if (!/Using a password on the command line|MYSQL_PWD/i.test(message)) stderr += message
    })
    child.on("error", (error) => reject(error))
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `mysql exited with code ${code}`))
    })
    createReadStream(dumpFile).pipe(child.stdin)
  })
}

const scratchDatabase = `trackify_restore_drill_${Date.now()}_${randomUUID().slice(0, 8).replaceAll("-", "")}`
if (!/^trackify_restore_drill_[a-zA-Z0-9_]+$/.test(scratchDatabase)) {
  fail("the generated scratch database name failed its safety check.")
}

let admin
let scratchFilesRoot
let created = false
try {
  admin = await mysql.createConnection({ host, port, user, password })
  await admin.query(`CREATE DATABASE \`${scratchDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  created = true
  console.log(`Created isolated scratch database ${scratchDatabase}.`)

  await restoreSql(findMysql(), scratchDatabase)

  const restored = await mysql.createConnection({ host, port, user, password, database: scratchDatabase })
  const source = await mysql.createConnection({ host, port, user, password, database: sourceDatabase })
  const [tableRows] = await restored.query(
    "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ?",
    [scratchDatabase],
  )
  if (Number(tableRows[0].total) < 1) throw new Error("the restored database contains no tables")

  const comparisons = []
  for (const table of ["schema_migrations", "users", "trip_tickets"]) {
    const [present] = await restored.query(
      "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
      [scratchDatabase, table],
    )
    if (!Number(present[0].total)) continue
    const [[sourceCount]] = await source.query(`SELECT COUNT(*) AS total FROM \`${table}\``)
    const [[restoredCount]] = await restored.query(`SELECT COUNT(*) AS total FROM \`${table}\``)
    if (Number(sourceCount.total) !== Number(restoredCount.total)) {
      throw new Error(`${table} count differs: source ${sourceCount.total}, restored ${restoredCount.total}`)
    }
    comparisons.push(`${table}: ${restoredCount.total}`)
  }
  await restored.end()
  await source.end()

  let fileResult = "not supplied"
  if (filesBackup) {
    scratchFilesRoot = await mkdtemp(path.join(tmpdir(), "trackify-restore-drill-"))
    const restoredFiles = path.join(scratchFilesRoot, "uploads")
    const before = await inventory(filesBackup)
    await cp(filesBackup, restoredFiles, { recursive: true })
    const after = await inventory(restoredFiles)
    if (before.files !== after.files || before.bytes !== after.bytes) {
      throw new Error("the restored upload copy does not match the backup")
    }
    fileResult = `${after.files} file(s), ${after.bytes} bytes`
  }

  console.log(`\nRestore drill passed.
  Tables restored: ${tableRows[0].total}
  Counts checked:  ${comparisons.join(", ") || "schema present"}
  Files restored:  ${fileResult}`)
} catch (error) {
  console.error(`\nRestore drill failed: ${error.message}`)
  process.exitCode = 1
} finally {
  if (scratchFilesRoot) await rm(scratchFilesRoot, { recursive: true, force: true })
  if (admin && created && !keepDatabase) {
    await admin.query(`DROP DATABASE \`${scratchDatabase}\``)
    console.log(`Removed scratch database ${scratchDatabase}.`)
  } else if (created) {
    console.log(`Kept scratch database ${scratchDatabase} because --keep was supplied.`)
  }
  await admin?.end()
}

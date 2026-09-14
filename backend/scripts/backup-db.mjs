/**
 * An off-platform logical backup of the Trackify database.
 *
 *   npm --prefix backend run db:backup
 *   npm --prefix backend run db:backup -- --out D:/backups
 *
 * The runbook asks for a periodic logical dump kept away from the hosting
 * platform, on the reasoning that a provider-level backup does not help if the
 * loss is the provider account itself. This produces one file you can copy to
 * a drive, a NAS, or cloud storage.
 *
 * Writes schema and data with `--single-transaction`, so InnoDB tables are
 * dumped from one consistent snapshot without locking writers out for the
 * duration — a driver filing an expense mid-backup neither blocks nor
 * corrupts it.
 *
 * A dump is not a backup until it has been restored. See the runbook for the
 * drill; an untested dump is a file you hope about.
 */
import "../src/config/env.js"
import { spawn } from "node:child_process"
import { createWriteStream, mkdirSync, existsSync, statSync } from "node:fs"
import { existsSync as fileExists } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { Transform } from "node:stream"

/**
 * Strips DEFINER clauses out of the dump as it streams past.
 *
 * mysqldump stamps every view, trigger, routine and event with the account
 * that created it. Restoring such a dump as any other user fails outright
 * unless that same account exists on the target — which, for a disaster
 * restore onto a fresh server, it usually does not. mysqldump has no flag
 * for this (--skip-definer belongs to other tools), so it is done here.
 */
function stripDefiner() {
  let tail = ""
  const DEFINER = /\sDEFINER=`[^`]*`@`[^`]*`/g
  return new Transform({
    transform(chunk, _enc, cb) {
      const text = tail + chunk.toString("utf8")
      // Hold back the last partial line so a DEFINER split across two
      // chunks is still matched whole.
      const cut = text.lastIndexOf("\n") + 1
      tail = text.slice(cut)
      cb(null, text.slice(0, cut).replace(DEFINER, ""))
    },
    flush(cb) {
      cb(null, tail.replace(DEFINER, ""))
    },
  })
}
const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  return i > -1 ? process.argv[i + 1] : fallback
}

const OUT_DIR = path.resolve(arg("--out", path.resolve(process.cwd(), "backups")))
const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env

if (!DB_NAME || !DB_USER) {
  console.error("DB_NAME and DB_USER must be set — check the root .env")
  process.exit(1)
}

/* mysqldump is not on PATH in a default Windows MySQL install, so the usual
 * locations are tried before giving up with something actionable. */
function findMysqldump() {
  if (process.env.MYSQLDUMP_PATH) return process.env.MYSQLDUMP_PATH
  // Absolute locations are checked first and bare "mysqldump" only as a last
  // resort: the bare name is always truthy, so testing it first silently wins
  // on machines where it is not actually on PATH, and spawn then fails with a
  // bare ENOENT that names nothing useful.
  const candidates = [
    "C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqldump.exe",
    "C:/Program Files/MySQL/MySQL Server 8.4/bin/mysqldump.exe",
    "/usr/bin/mysqldump",
    "/usr/local/bin/mysqldump",
  ]
  const found = candidates.find((c) => fileExists(c))
  if (found) return found
  return onPath("mysqldump") ? "mysqldump" : null
}

const mysqldump = findMysqldump()
if (!mysqldump) {
  console.error(
    "\n  Could not find mysqldump.\n\n" +
      "  It ships with MySQL Server but is not added to PATH on Windows.\n" +
      "  Set MYSQLDUMP_PATH to its full location, for example:\n\n" +
      '    MYSQLDUMP_PATH="C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqldump.exe"\n',
  )
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
const outFile = path.join(OUT_DIR, `trackify-${stamp}.sql`)

const args = [
  `--host=${DB_HOST || "localhost"}`,
  `--port=${DB_PORT || 3306}`,
  `--user=${DB_USER}`,
  // One consistent snapshot, without holding a global lock for the whole dump.
  "--single-transaction",
  // MySQL 8 dumps tablespace metadata by default, which needs the PROCESS
  // privilege — a grant an application user has no business holding. The
  // metadata is irrelevant to a logical restore anyway.
  "--no-tablespaces",
  "--routines",
  "--triggers",
  "--events",
  "--default-character-set=utf8mb4",
  DB_NAME,
]

console.log(`Dumping ${DB_NAME} -> ${outFile}`)

const child = spawn(mysqldump, args, {
  // Passed this way rather than --password= so it never appears in the process
  // list, where any other user on the machine could read it.
  env: { ...process.env, MYSQL_PWD: DB_PASSWORD || "" },
})

const out = createWriteStream(outFile)
child.stdout.pipe(stripDefiner()).pipe(out)

let stderr = ""
child.stderr.on("data", (d) => {
  const s = d.toString()
  stderr += s
  // mysqldump warns about MYSQL_PWD on every run; it is the safer option here.
  if (!/Using a password on the command line|MYSQL_PWD/i.test(s)) process.stderr.write(s)
})

child.on("close", (code) => {
  out.end()
  if (code !== 0) {
    console.error(`\nmysqldump exited ${code}\n${stderr.trim()}`)
    process.exit(code ?? 1)
  }
  out.on("finish", () => {
    const bytes = existsSync(outFile) ? statSync(outFile).size : 0
    if (bytes < 1024) {
      console.error(`\nThe dump is only ${bytes} bytes — that is not a database.`)
      process.exit(1)
    }
    console.log(`
  Backup written: ${outFile}
  Size: ${(bytes / 1024 / 1024).toFixed(2)} MB

  Copy it somewhere that is not this machine and not the hosting platform.
  Then, at least once, restore it into a scratch database and confirm a
  receipt and a trip come back — a dump nobody has restored is a file you
  hope about, not a backup.

    mysql -u root -p -e "CREATE DATABASE trackify_restore_test"
    mysql -u root -p trackify_restore_test < "${outFile}"
`)
  })
})

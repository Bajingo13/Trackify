import bcrypt from "bcrypt";
import db from "../config/db.js";
import { isProduction } from "./environment.js";

/**
 * Refuse to hold real data behind a published password.
 *
 * The system ships with demonstration accounts so it can be shown without
 * setup: staff logins sharing one password, and a driver PIN of 1234. That is
 * harmless on a laptop and indefensible the moment the system has a public
 * address and a real company's trips in it. Throttling does not help, because
 * the secret was never secret — anyone who has seen a demo can sign in.
 *
 * `npm run creds:rotate -- --all --confirm` replaces them, and has existed for
 * a while. The gap this closes is that nothing checked whether anybody ran it.
 * A go-live checklist is a piece of paper; this is the system declining to
 * serve real data with the demo keys still in the door.
 *
 * Checked in the background after the server is listening, not before: bcrypt
 * is deliberately slow, and delaying every boot by several seconds to re-prove
 * something that is almost always fine is a cost paid on every restart.
 */

/* The secrets published in migrations, seeds and the demo documentation.
 * Exported because the password policy refuses them too — it would be absurd
 * to stop the server booting on a demo password and then let somebody type one
 * back in from the profile screen. */
export const DEMO_PASSWORDS = ["admin123", "driver123"];
export const DEMO_PINS = ["1234"];

/**
 * Is this the published demonstration PIN?
 *
 * Checked at sign-in as well as at startup. A driver whose PIN is still 1234
 * is refused at the door rather than having the whole API refuse to run: the
 * exposure is that one driver's own trips, and taking a fleet's dispatch
 * offline over it costs more than it protects.
 */
export const isDemoPin = (pin) => DEMO_PINS.includes(String(pin ?? "").trim());

/**
 * Accounts still using a known demonstration secret.
 *
 * Stops at the first of each kind: one is enough to refuse, and every extra
 * comparison is another slow hash for an answer already known.
 */
export async function findDemoCredentials(runner = db) {
  const found = { staff: [], drivers: [] };

  const [users] = await runner.execute(
    "SELECT user_id, email, password_hash FROM users WHERE status = 'active'"
  );
  outer: for (const user of users) {
    for (const password of DEMO_PASSWORDS) {
      // eslint-disable-next-line no-await-in-loop
      if (await bcrypt.compare(password, user.password_hash || "")) {
        found.staff.push(user.email);
        break outer;
      }
    }
  }

  const [drivers] = await runner.execute(
    "SELECT driver_id, employee_no, pin_hash FROM drivers WHERE pin_hash IS NOT NULL AND status = 'active'"
  );
  outerPins: for (const driver of drivers) {
    for (const pin of DEMO_PINS) {
      // eslint-disable-next-line no-await-in-loop
      if (await bcrypt.compare(pin, driver.pin_hash || "")) {
        found.drivers.push(driver.employee_no);
        break outerPins;
      }
    }
  }

  return found;
}

/* Defined once in shared/environment.js; re-exported so existing imports from
 * here keep working. */
export { isProduction };

/**
 * Run the check and, in production, refuse to keep serving if it fails.
 *
 * Exiting is the point. A warning in a log is read by whoever is already
 * looking, which is nobody on the day this matters; a process that will not
 * stay up is read by everybody, and the fix is one command.
 */
export async function enforceDemoCredentialPolicy({
  env = process.env,
  exit = (code) => process.exit(code),
  log = console,
  /* Injectable so a test can exercise the decision without opening the
   * application's connection pool — which, left open, keeps the process alive
   * and turns a passing test run into a hang. */
  find = findDemoCredentials,
} = {}) {
  if (!isProduction(env)) return { checked: false, found: null };

  let found;
  try {
    found = await find();
  } catch (error) {
    // A check that cannot run must not take down a healthy system on its own
    // say-so. Report it and leave the decision to a human.
    log.error(`[credentials] Could not verify demo credentials: ${error.message}`);
    return { checked: false, found: null };
  }

  if (!found.staff.length && !found.drivers.length) {
    log.log("Demo credentials: none in use");
    return { checked: true, found };
  }

  /*
   * A weak driver PIN and a weak staff password are not the same problem, and
   * the first version of this treated them as one.
   *
   * A demonstration STAFF password is a way into a company's whole operation:
   * its trips, its customers, its money. There is no safe way to keep serving
   * while one is live, so this still refuses to start.
   *
   * A demonstration driver PIN exposes that one driver's own trips and nothing
   * else, because a Driver App token cannot reach a staff route. Refusing to
   * start over one took this system's production server down for a day over a
   * single seeded account, while every real driver, the dispatchers and every
   * trip in the system waited on a PIN nobody was using. That trade was wrong.
   * The door is shut at sign-in instead, by isDemoPin, so the exposure closes
   * without the fleet going dark.
   */
  if (found.drivers.length) {
    log.error(
      [
        "",
        `  DRIVER APP SIGN-IN BLOCKED for: ${found.drivers.join(", ")}`,
        "",
        "  These drivers still have the published PIN, which is in the repository,",
        "  the seed data and every demonstration ever given. They cannot sign in",
        "  until it is changed. The rest of the system is unaffected.",
        "",
        "    npm run creds:rotate -- --drivers --employee-no <EMPLOYEE NO> --confirm",
        "",
      ].join("\n")
    );
  }

  if (!found.staff.length) return { checked: true, found };

  log.error(
    [
      "",
      "  REFUSING TO START - demonstration staff credentials are still in use.",
      "",
      `  Staff accounts with the published password: ${found.staff.join(", ")}`,
      "",
      "  This installation looks like production, and this password is in the",
      "  repository, the seed data and every demonstration ever given. Anyone",
      "  who has seen it can sign in and read a company's trips.",
      "",
      "    npm run creds:rotate -- --staff --confirm",
      "",
      "  It prints each new credential once and stores nothing recoverable.",
      "",
    ].join("\n")
  );

  exit(1);
  return { checked: true, found };
}

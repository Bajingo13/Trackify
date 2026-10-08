/**
 * A last line of defence for the API process.
 *
 * Express turns an error thrown inside a request into a 500 for that request.
 * What it cannot catch is a promise nobody awaited (a background job, a
 * fire-and-forget audit write) or an exception thrown from an event emitter's
 * callback. Since Node 15 an unhandled rejection ends the process, so one
 * stray failure in one corner took every signed-in user's session with it.
 *
 *   • unhandledRejection: log it and carry on. The request that caused it has
 *     usually already been answered; restarting the whole server for it is the
 *     larger harm.
 *   • uncaughtException: the process is in an unknown state, so log it and
 *     exit non-zero and let the supervisor restart it cleanly. Carrying on
 *     after one of these is how corrupted state turns into silent wrong data.
 *
 * What is logged is the error's name, code and stack with quoted text removed
 * — as errorHandler does — because an error message can carry a customer's
 * email or plate number.
 */
const redact = (text) => String(text ?? "").replace(/'[^']*'/g, "'…'").replace(/"[^"]*"/g, '"…"');

function describe(error) {
  if (error instanceof Error) {
    const code = error.code ? ` ${error.code}` : "";
    return `${error.name}${code}: ${redact(error.stack || error.message)}`;
  }
  return redact(typeof error === "string" ? error : JSON.stringify(error));
}

export function installProcessGuards({ target = process, log = console.error, exit = process.exit } = {}) {
  const onRejection = (reason) => {
    log(`[process] unhandled rejection — continuing. ${describe(reason)}`);
  };
  const onException = (error) => {
    log(`[process] uncaught exception — exiting so the supervisor can restart. ${describe(error)}`);
    exit(1);
  };
  target.on("unhandledRejection", onRejection);
  target.on("uncaughtException", onException);
  return () => {
    target.off("unhandledRejection", onRejection);
    target.off("uncaughtException", onException);
  };
}

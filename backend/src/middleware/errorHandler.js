/* MySQL error codes that mean "the database itself is unreachable / misconfigured". */
const DB_DOWN_CODES = new Set([
  "ER_ACCESS_DENIED_ERROR",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "PROTOCOL_CONNECTION_LOST",
  "ER_BAD_DB_ERROR",
]);

function errorHandler(error, req, res, next) {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  const isDev = process.env.NODE_ENV === "development";

  if (DB_DOWN_CODES.has(error.code)) {
    return res.status(503).json({
      success: false,
      message: isDev
        ? `Database unavailable (${error.code}). Check the DB_* values in your .env — DB_PASSWORD is most likely missing or wrong.`
        : "Service temporarily unavailable.",
    });
  }

  /*
   * A unique key was violated: an employee number, a plate, a ticket number
   * that somebody else already has. That is a correctable mistake by the
   * person filling the form, and answering it with "internal server error"
   * hides the one thing they could act on.
   */
  if (error.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      success: false,
      message: isDev
        ? `Already in use — ${error.sqlMessage}`
        : "That value is already in use. Check the identifying numbers on this form.",
    });
  }

  return res.status(error.status || 500).json({
    success: false,
    message: isDev ? error.message : "Internal server error.",
  });
}

export default errorHandler;

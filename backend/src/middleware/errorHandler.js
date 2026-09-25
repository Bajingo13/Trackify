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

  /* An upload that broke a limit. multer sets no status, so these fell through
   * to 500 — see the note in receipts.storage.js on why that froze the Driver
   * App's offline queue. */
  if (error.name === "MulterError") {
    const { status, message } = describeUploadError(error);
    return res.status(status).json({ success: false, message });
  }

  /*
   * A 4xx is the client's own correctable mistake, and its message was written
   * for them: "Your photo must be a JPG, PNG, WebP or HEIC image." This branch
   * used to replace every message with "Internal server error." in production
   * — so a driver who attached a PDF was told the server was broken, and
   * nobody could see why, because the audit that looked ran in development.
   *
   * Only the 5xx path stays masked: that is where an internal message could
   * describe the server rather than the request.
   */
  const status = Number(error.status || error.statusCode) || 500;
  if (status >= 400 && status < 500) {
    return res.status(status).json({ success: false, message: clientMessage(error) });
  }

  return res.status(status).json({
    success: false,
    message: isDev ? error.message : "Internal server error.",
  });
}

/** What to tell somebody whose request was refused, in their terms. */
function clientMessage(error) {
  // body-parser's own wording ("Unexpected token n in JSON at position 1")
  // is accurate and useless to anybody reading it.
  if (error.type === "entity.parse.failed") return "The request could not be read — it was not valid JSON.";
  if (error.type === "entity.too.large") return "That request is too large to process.";
  return error.message || "The request could not be completed.";
}

function describeUploadError(error) {
  if (error.code === "LIMIT_FILE_SIZE") {
    if (error.maxBytes) {
      const mb = Math.round((error.maxBytes / (1024 * 1024)) * 10) / 10;
      return {
        status: 413,
        message: `That file is too large. The most that can be uploaded here is ${mb} MB — try a smaller photo, or take it at a lower resolution.`,
      };
    }
    return { status: 413, message: "That file is too large to upload." };
  }
  if (error.code === "LIMIT_UNEXPECTED_FILE") {
    return { status: 400, message: "The file was sent in a field this form does not expect." };
  }
  if (error.code === "LIMIT_FILE_COUNT") {
    return { status: 400, message: "Attach one file at a time." };
  }
  return { status: 400, message: "The upload was not in a form this server accepts." };
}

export default errorHandler;

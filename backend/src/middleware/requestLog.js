import morgan from "morgan";

/**
 * One line per request: method, path, status, time, size.
 *
 * Deliberately without the query string. morgan's "dev" format logged the
 * whole URL, and search boxes put what was typed into the query — a customer's
 * name, a plate number, an email — so every search went into the production
 * log. Same rule as the error log (middleware/errorHandler.js): nothing a
 * person typed is written down.
 *
 * Plain text rather than "dev"'s colour codes, which arrive in a hosted log
 * viewer as escape-sequence noise.
 */
export const pathOnly = (req) => String(req.originalUrl || req.url || "").split("?")[0];

morgan.token("path-only", pathOnly);

export const REQUEST_LOG_FORMAT = ":method :path-only :status :response-time ms - :res[content-length]";

export default function requestLog() {
  return morgan(REQUEST_LOG_FORMAT);
}

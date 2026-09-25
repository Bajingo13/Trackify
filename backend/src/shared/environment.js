/**
 * Is this installation holding somebody's real work?
 *
 * One definition, used everywhere the answer changes behaviour. It used to be
 * asked two different ways: most places checked NODE_ENV alone, while the
 * demo-credential guard also counted RAILWAY_ENVIRONMENT. A deployment that
 * lost NODE_ENV would therefore have been "production" to one check and
 * "development" to the others — registering the route that clears the
 * brute-force throttle, accepting localhost as a CORS origin, and treating
 * every visitor behind Railway's proxy as one address.
 *
 * Kept free of imports so the CORS config and the app factory can use it
 * without opening a database pool.
 */
export const isProduction = (env = process.env) =>
  env.NODE_ENV === "production" || Boolean(env.RAILWAY_ENVIRONMENT);

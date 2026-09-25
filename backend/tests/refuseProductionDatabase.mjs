/**
 * Loaded before every test file by `npm test` (via --import).
 *
 * The suite creates and deletes companies, users and trips in whatever
 * database DB_* names. If that is production, stop before any of it runs.
 * See src/shared/productionDatabaseGuard.js for what counts as production.
 */
import "../src/config/env.js";
import { refuseProductionDatabase } from "../src/shared/productionDatabaseGuard.js";

refuseProductionDatabase("the test suite");

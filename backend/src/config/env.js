/**
 * Loads environment variables from the monorepo root `.env` regardless of the
 * current working directory (works for `cd backend && npm run dev` and for
 * `npm run dev` from the repo root). Import this first, before any module that
 * reads process.env.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(here, "..", "..", "..", ".env");

dotenv.config({ path: rootEnv, quiet: true });

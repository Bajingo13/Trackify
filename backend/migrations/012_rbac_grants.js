/**
 * 012 — RBAC grant refresh.
 *
 * Re-runs the additive role/permission provisioning so template changes in
 * src/shared/rbac.js land in every company's system roles:
 *   - Dispatcher      += customer.manage  (add customers while booking trips)
 *   - Branch Manager  += expense.manage   (record trip expenses; still no
 *                                          voucher.manage / voucher.approve)
 *
 * provisionAllCompanies is additive + idempotent: it never removes a
 * permission an admin added and never drops a role.
 */
import { provisionAllCompanies } from "../src/shared/provisionRoles.js";

export async function up(conn) {
  await provisionAllCompanies(conn);
}

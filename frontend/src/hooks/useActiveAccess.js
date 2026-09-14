import { useAuth } from "../context/AuthContext";

/**
 * The company/branch you're actually operating in right now — same source the
 * topbar switcher reads and writes (`ttms_company_id` / `ttms_branch_id` in
 * localStorage) — plus the full access list.
 *
 * Never fall back to `user.access[0]` alone: for anyone with more than one
 * grant (a System Administrator, or a user with access to several branches),
 * the first entry is not necessarily the one currently selected, and often
 * has no branch name at all (a company-wide "all branches" row sorts first).
 */
export default function useActiveAccess() {
  const { user } = useAuth();
  const accessList = Array.isArray(user?.access) ? user.access : [];

  const activeCompanyId = (() => {
    try { return localStorage.getItem("ttms_company_id") || accessList[0]?.company_id; }
    catch { return accessList[0]?.company_id; }
  })();
  const activeBranchId = (() => {
    try { return localStorage.getItem("ttms_branch_id") || accessList[0]?.branch_id; }
    catch { return accessList[0]?.branch_id; }
  })();

  const current =
    accessList.find(
      (a) => String(a.company_id) === String(activeCompanyId)
        && String(a.branch_id ?? "") === String(activeBranchId ?? "")
    ) || accessList[0];

  return { accessList, activeCompanyId, activeBranchId, current };
}

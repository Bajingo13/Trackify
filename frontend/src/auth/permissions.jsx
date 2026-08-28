import { useAuth } from "../context/AuthContext";

/**
 * Permission helpers for components.
 *
 *   const { can, canAny } = usePermissions();
 *   can("trip.approve")            -> boolean
 *   <Can permission="trip.create"><button>New Trip</button></Can>
 */
export function usePermissions() {
  const { hasPermission, hasAnyPermission, hasAllPermissions, isSystemAdmin, permissions } = useAuth();
  return {
    can: hasPermission,
    canAny: hasAnyPermission,
    canAll: hasAllPermissions,
    isSystemAdmin,
    permissions,
  };
}

/**
 * Conditionally render. Pass one of `permission`, `anyOf`, `allOf`.
 * `fallback` renders when the check fails (default: nothing).
 */
export function Can({ permission, anyOf, allOf, fallback = null, children }) {
  const { can, canAny, canAll } = usePermissions();

  let ok = true;
  if (permission) ok = can(permission);
  else if (anyOf) ok = canAny(anyOf);
  else if (allOf) ok = canAll(allOf);

  return ok ? children : fallback;
}

import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import ForbiddenPage from "../pages/ForbiddenPage";

/**
 * Route guard that checks a permission, not just "logged in".
 *
 *   <RequirePermission permission="trip.read"><TripsPage /></RequirePermission>
 *   <RequirePermission anyOf={["report.operations","report.fleet"]}>...</RequirePermission>
 *
 * Not logged in  -> /login
 * Logged in, no permission -> Forbidden page (nav still available)
 */
export default function RequirePermission({ permission, anyOf, children }) {
  const { user, hasPermission, hasAnyPermission } = useAuth();

  if (!user) return <Navigate to="/login" replace />;

  const ok = anyOf ? hasAnyPermission(anyOf) : hasPermission(permission);
  if (!ok) return <ForbiddenPage />;

  return children;
}

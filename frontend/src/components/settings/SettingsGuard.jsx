import { usePermissions } from "../../auth/permissions";
import SettingsForbidden from "./SettingsForbidden";

/**
 * Permission gate for a Settings route. Unlike the app-wide RequirePermission
 * (which renders a full-page Forbidden with its own shell), this renders an
 * inline panel, because the route already sits inside the Settings shell.
 * Assumes the caller is already behind an auth check.
 */
export default function SettingsGuard({ permission, anyOf, children }) {
  const { can, canAny } = usePermissions();
  const ok = anyOf ? canAny(anyOf) : can(permission);
  return ok ? children : <SettingsForbidden />;
}

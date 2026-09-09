import {
  UserCircle, SlidersHorizontal, Bell, Building2, MapPin, Users,
  ShieldCheck, Plug, Settings2,
} from "lucide-react";

/**
 * The Settings workspace nav — what used to be the "Administration" group,
 * regrouped by purpose and reached from the top-bar account menu instead of
 * the main sidebar. Both the left rail and the overview cards read this.
 *
 * `kind: "account"` items are personal and shown to every signed-in user;
 * the rest carry the same permission the old admin pages did.
 */
const settingsNav = [
  {
    label: "Account",
    items: [
      { label: "My Profile", path: "/admin/settings/profile", icon: UserCircle, kind: "account" },
      { label: "Preferences", path: "/admin/settings/preferences", icon: SlidersHorizontal, kind: "account" },
      { label: "Notifications", path: "/admin/settings/notifications", icon: Bell, kind: "account" },
    ],
  },
  {
    label: "Organization",
    items: [
      { label: "Companies", path: "/admin/settings/companies", icon: Building2, permission: "company.read" },
      { label: "Branches", path: "/admin/settings/branches", icon: MapPin, permission: "branch.read" },
    ],
  },
  {
    label: "User Management",
    items: [
      { label: "Users", path: "/admin/settings/users", icon: Users, permission: "user.read" },
      { label: "Roles & Permissions", path: "/admin/settings/roles", icon: ShieldCheck, permission: "role.read" },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Integrations", path: "/admin/settings/integrations", icon: Plug, permission: "integration.read" },
      { label: "General Settings", path: "/admin/settings/general", icon: Settings2, permission: "settings.read" },
    ],
  },
];

/** Every permission that grants a peek at the workspace — used to gate the overview route. */
export const SETTINGS_ANY_PERMISSION = [
  ...new Set(
    settingsNav.flatMap((g) => g.items.map((i) => i.permission).filter(Boolean))
  ),
];

/** Prune groups/items to what `can(permission)` allows. Account items always pass. */
export function filterSettingsNav(can) {
  return settingsNav
    .map((group) => {
      const items = group.items.filter((i) => !i.permission || can(i.permission));
      return items.length ? { ...group, items } : null;
    })
    .filter(Boolean);
}

export default settingsNav;

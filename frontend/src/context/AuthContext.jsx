import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";

const AuthContext = createContext(null);

import { API_ORIGIN } from "../services/apiOrigin";

const API_BASE = API_ORIGIN;
const SYSTEM_ADMIN = "system.admin";

function readStored() {
  try {
    const raw = localStorage.getItem("ttms_auth");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStored);

  const persist = useCallback((userData) => {
    setUser(userData);
    if (userData) localStorage.setItem("ttms_auth", JSON.stringify(userData));
    else localStorage.removeItem("ttms_auth");
  }, []);

  const login = useCallback(async (email, password) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        return { success: false, error: data.message || "Login failed", code: data.code };
      }

      const userData = {
        ...data.data.user,
        token: data.data.token,
        access: data.data.access || [],
        roles: data.data.roles || [],
        permissions: data.data.permissions || [],
      };
      persist(userData);

      // Sign in to a scope the API will actually accept. A System
      // Administrator's access list now leads with a company-wide row whose
      // branch is null, but every /api/v1 route requires both a company and a
      // branch — so land on the first entry that carries a branch and fall
      // back to the leading row only when nothing else is on offer. The
      // operating-context switcher can still move them anywhere afterwards.
      const first = userData.access[0];
      const withBranch = userData.access.find((a) => a.branch_id);
      const start = withBranch || first;
      if (start) {
        localStorage.setItem("ttms_company_id", start.company_id);
        if (start.branch_id) localStorage.setItem("ttms_branch_id", start.branch_id);
        else localStorage.removeItem("ttms_branch_id");
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || "Network error" };
    }
  }, [persist]);

  const logout = useCallback(() => {
    persist(null);
    localStorage.removeItem("ttms_company_id");
    localStorage.removeItem("ttms_branch_id");
  }, [persist]);

  /** Re-pull identity + effective permissions for the current operating scope. */
  const refresh = useCallback(async () => {
    const stored = readStored();
    if (!stored?.token) return;
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${stored.token}`,
          "X-Company-Id": localStorage.getItem("ttms_company_id") || "",
          "X-Branch-Id": localStorage.getItem("ttms_branch_id") || "",
        },
      });
      if (res.status === 401) {
        logout();
        return;
      }
      const data = await res.json();
      if (res.ok && data.data) {
        persist({
          ...stored,
          ...data.data.user,
          access: data.data.access || stored.access,
          roles: data.data.roles || stored.roles,
          permissions: data.data.permissions || stored.permissions,
        });
      }
    } catch {
      /* keep the cached session on a transient network error */
    }
  }, [logout, persist]);

  // Session invalidated elsewhere (apiClient dispatches this on a 401).
  useEffect(() => {
    function onExpired() {
      logout();
    }
    window.addEventListener("ttms:session-expired", onExpired);
    return () => window.removeEventListener("ttms:session-expired", onExpired);
  }, [logout]);

  const permissionSet = useMemo(
    () => new Set(user?.permissions || []),
    [user]
  );

  const isSystemAdmin = permissionSet.has(SYSTEM_ADMIN);

  const hasPermission = useCallback(
    (code) => !code || isSystemAdmin || permissionSet.has(code),
    [permissionSet, isSystemAdmin]
  );
  const hasAnyPermission = useCallback(
    (codes = []) => codes.length === 0 || isSystemAdmin || codes.some((c) => permissionSet.has(c)),
    [permissionSet, isSystemAdmin]
  );
  const hasAllPermissions = useCallback(
    (codes = []) => isSystemAdmin || codes.every((c) => permissionSet.has(c)),
    [permissionSet, isSystemAdmin]
  );

  const value = useMemo(
    () => ({
      user,
      login,
      logout,
      refresh,
      permissions: user?.permissions || [],
      isSystemAdmin,
      hasPermission,
      hasAnyPermission,
      hasAllPermissions,
    }),
    [user, login, logout, refresh, isSystemAdmin, hasPermission, hasAnyPermission, hasAllPermissions]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

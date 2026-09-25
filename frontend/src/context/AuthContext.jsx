import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";

const AuthContext = createContext(null);

import { API_ORIGIN } from "../services/apiOrigin";
import { forgetAgreement } from "../services/agreementService";
import { fetchWithTimeout } from "../services/fetchWithTimeout";

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
      // Bounded: an unanswered sign-in used to leave "Signing in…" on screen
      // for ever. It now fails with a sentence the catch below shows.
      const res = await fetchWithTimeout(`${API_BASE}/api/auth/login`, {
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

      /*
       * Land on the first scope offered.
       *
       * This used to hunt for an entry carrying a branch, because the access
       * list led with a company-wide row whose branch was null while every
       * /api/v1 route requires a branch — so signing in to the first entry
       * meant signing in to a 400. The server no longer offers unusable rows:
       * a company-wide grant is expanded into the branches it covers. The
       * hunt is therefore dead code, and keeping it would suggest the list
       * still contains something that has to be stepped around.
       */
      const start = userData.access[0];
      if (start) {
        localStorage.setItem("ttms_company_id", start.company_id);
        localStorage.setItem("ttms_branch_id", start.branch_id);
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || "Network error" };
    }
  }, [persist]);

  const completeInitialPassword = useCallback(async (newPassword) => {
    const stored = readStored();
    if (!stored?.token) return { success: false, error: "Your session has expired." };
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/auth/activate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${stored.token}`,
        },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.message || "Could not activate the account.", code: data.code };

      const userData = {
        ...data.data.user,
        token: data.data.token,
        access: data.data.access || [],
        roles: data.data.roles || [],
        permissions: data.data.permissions || [],
      };
      persist(userData);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message || "Network error" };
    }
  }, [persist]);

  const logout = useCallback(() => {
    persist(null);
    localStorage.removeItem("ttms_company_id");
    localStorage.removeItem("ttms_branch_id");
    // The agreement answer is cached for the session. Without this the next
    // person to sign in on this browser would inherit the previous user's
    // acceptance and never be shown the Agreement.
    forgetAgreement();
  }, [persist]);

  /** Re-pull identity + effective permissions for the current operating scope. */
  const refresh = useCallback(async () => {
    const stored = readStored();
    if (!stored?.token) return;
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/auth/me`, {
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
    function onPasswordChangeRequired() {
      const stored = readStored();
      if (stored) persist({ ...stored, mustChangePassword: true });
    }
    window.addEventListener("ttms:session-expired", onExpired);
    window.addEventListener("ttms:password-change-required", onPasswordChangeRequired);
    return () => {
      window.removeEventListener("ttms:session-expired", onExpired);
      window.removeEventListener("ttms:password-change-required", onPasswordChangeRequired);
    };
  }, [logout, persist]);

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
      completeInitialPassword,
      logout,
      refresh,
      permissions: user?.permissions || [],
      isSystemAdmin,
      hasPermission,
      hasAnyPermission,
      hasAllPermissions,
    }),
    [user, login, completeInitialPassword, logout, refresh, isSystemAdmin, hasPermission, hasAnyPermission, hasAllPermissions]
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

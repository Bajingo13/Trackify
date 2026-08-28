import { createContext, useContext, useState, useCallback } from "react";

const AuthContext = createContext(null);

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("ttms_auth");
    return saved ? JSON.parse(saved) : null;
  });

  const login = useCallback(async (email, password) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        return { success: false, error: data.message || "Login failed" };
      }

      const userData = {
        ...data.data.user,
        token: data.data.token,
        access: data.data.access,
        roles: data.data.roles,
      };

      setUser(userData);
      localStorage.setItem("ttms_auth", JSON.stringify(userData));

      if (data.data.access?.length > 0) {
        const first = data.data.access[0];
        localStorage.setItem("ttms_company_id", first.company_id);
        if (first.branch_id) localStorage.setItem("ttms_branch_id", first.branch_id);
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || "Network error" };
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem("ttms_auth");
    localStorage.removeItem("ttms_company_id");
    localStorage.removeItem("ttms_branch_id");
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

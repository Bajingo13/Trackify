import { createContext, useContext, useState, useCallback } from "react";

const AuthContext = createContext(null);

const MOCK_USERS = [
  {
    email: "sajibur@email.com",
    password: "admin123",
    name: "Sajibur Rahman",
    firstName: "Sajibur",
    role: "Admin",
  },
  {
    email: "driver@email.com",
    password: "driver123",
    name: "Juan Dela Cruz",
    firstName: "Juan",
    role: "Driver",
  },
];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("ttms_auth");
    return saved ? JSON.parse(saved) : null;
  });

  const login = useCallback((email, password) => {
    const found = MOCK_USERS.find(
      (u) => u.email === email && u.password === password
    );
    if (!found) {
      return { success: false, error: "Invalid email or password" };
    }
    const userData = { ...found };
    delete userData.password;
    setUser(userData);
    localStorage.setItem("ttms_auth", JSON.stringify(userData));
    return { success: true };
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem("ttms_auth");
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

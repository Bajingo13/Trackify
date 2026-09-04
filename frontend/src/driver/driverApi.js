const ORIGIN = import.meta.env.VITE_API_URL || "http://localhost:5000";
const BASE = `${ORIGIN.replace(/\/+$/, "")}/api/v1/driver`;
const KEY = "ttms_driver_auth";

export const getDriverAuth = () => {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
};
export const setDriverAuth = (a) => localStorage.setItem(KEY, JSON.stringify(a));
export const clearDriverAuth = () => localStorage.removeItem(KEY);

async function req(path, opts = {}) {
  const auth = getDriverAuth();
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  const r = await fetch(BASE + path, { ...opts, headers });
  let data = {};
  try { data = await r.json(); } catch { /* empty */ }
  if (r.status === 401 && !path.startsWith("/auth")) {
    clearDriverAuth();
    window.location.assign("/driver");
    throw new Error("Session expired");
  }
  if (!r.ok) {
    const e = new Error(data.message || "Something went wrong");
    e.status = r.status;
    throw e;
  }
  return data;
}

export const driverLogin = (employeeNo, pin) =>
  req("/auth/login", { method: "POST", body: JSON.stringify({ employeeNo, pin }) });
export const driverTrips = () => req("/trips").then((d) => d.data || []);
export const driverTrip = (id) => req(`/trips/${id}`).then((d) => d.data);
export const driverPing = (id, body) => req(`/trips/${id}/ping`, { method: "POST", body: JSON.stringify(body) });
export const driverStart = (id) => req(`/trips/${id}/start`, { method: "POST" });
export const driverDeliver = (id, receivedBy) =>
  req(`/trips/${id}/deliver`, { method: "POST", body: JSON.stringify({ receivedBy }) });

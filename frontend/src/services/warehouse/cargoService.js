import { get, post } from "../apiClient";

export async function getCargoQueue(type) {
  const res = await get(`/warehouse/cargo/queue?type=${type}`);
  return res.data || [];
}
export async function getCargoEvents() {
  const res = await get("/warehouse/cargo/events");
  return res.data || [];
}
export async function getCargoStats() {
  const res = await get("/warehouse/cargo/stats");
  return res.data || { pendingRelease: 0, pendingReturn: 0, releasedToday: 0, totalReturned: 0 };
}
export async function releaseCargo(payload) {
  return post("/warehouse/cargo/release", payload);
}
export async function returnCargo(payload) {
  return post("/warehouse/cargo/return", payload);
}

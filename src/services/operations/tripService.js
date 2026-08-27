import { get, post, patch } from "../apiClient";

export async function getAllTrips(params = {}) {
  const query = new URLSearchParams();
  if (params.status && params.status !== "all") query.set("status", params.status);
  if (params.search) query.set("search", params.search);
  if (params.page) query.set("page", params.page);
  if (params.limit) query.set("limit", params.limit);

  const qs = query.toString();
  const res = await get(`/operations/trips${qs ? `?${qs}` : ""}`);
  return res.data;
}

export async function getTripById(id) {
  const res = await get(`/operations/trips/${id}`);
  return res.data;
}

export async function getTripStats() {
  const res = await get("/operations/trips?limit=1000");
  const trips = res.data || [];
  const total = trips.length;
  const draft = trips.filter((t) => t.status === "draft").length;
  const pending = trips.filter((t) => ["validated", "for_validation", "for_approval"].includes(t.status)).length;
  const approved = trips.filter((t) => ["approved", "assigned", "accepted", "released"].includes(t.status)).length;
  const inTransit = trips.filter((t) => t.status === "in_transit").length;
  const delivered = trips.filter((t) => t.status === "delivered").length;
  const closed = trips.filter((t) => t.status === "operationally_closed").length;
  const rejected = trips.filter((t) => t.status === "rejected").length;
  const cancelled = trips.filter((t) => t.status === "cancelled").length;
  return { total, draft, pending, approved, inTransit, delivered, closed, rejected, cancelled };
}

export async function createTrip(data) {
  const res = await post("/operations/trips", data);
  return res;
}

export async function updateTrip(id, data) {
  const res = await patch(`/operations/trips/${id}`, data);
  return res;
}

export async function submitTrip(id) {
  const res = await post(`/operations/trips/${id}/submit`);
  return res;
}

export async function getTripActivities(tripId) {
  const trip = await getTripById(tripId);
  return trip.history || [];
}

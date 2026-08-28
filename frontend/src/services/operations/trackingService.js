import { get } from "../apiClient";

export async function getActiveTripsWithTracking() {
  const res = await get("/operations/tracking/active-trips");
  return res.data || [];
}

export async function getTrackingHistory(tripId) {
  const res = await get(`/operations/tracking/trips/${tripId}/history`);
  return res.data || [];
}

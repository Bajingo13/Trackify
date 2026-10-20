import { get, post } from "../apiClient";

/**
 * The phones a driver signs in on (backend fleet/driverDevices.controller.js).
 * One is trusted; others wait for the emailed code or for the office.
 * All of it needs driver.device.manage.
 */

/** Fired when the office approves, refuses or resets a phone, so the bell drops the request at once. */
export const DEVICE_REQUESTS_CHANGED_EVENT = "trackify:device-requests-changed";

/** Phones across the company waiting for the office: [{ deviceId, driverId, driverName, employeeNo, askedAt, locked }] */
export const getPendingDriverDevices = () =>
  get("/fleet/driver-devices/pending").then((r) => r.data || []);

/** { devices: [{ id, status, userAgent, approvedVia, approvedBy, lastSeenAt, officeRequestedAt, ... }], email, locked, failures } */
export const getDriverDevices = (driverId) =>
  get(`/fleet/drivers/${driverId}/devices`).then((r) => r.data);

/** Only after calling the driver on the number on file: the server refuses without confirmedByCall. */
export const approveDriverDevice = (driverId, deviceId) =>
  post(`/fleet/drivers/${driverId}/devices/${deviceId}/approve`, { confirmedByCall: true });

export const revokeDriverDevice = (driverId, deviceId) =>
  post(`/fleet/drivers/${driverId}/devices/${deviceId}/revoke`, {});

/** Undo a sign-out. The phone is not trusted by this: its next sign-in waits for a code or approval. */
export const unblockDriverDevice = (driverId, deviceId) =>
  post(`/fleet/drivers/${driverId}/devices/${deviceId}/unblock`, {});

/** Every phone signed out, codes cancelled, lock lifted: the next sign-in sets up a trusted phone. */
export const resetDriverDevices = (driverId) =>
  post(`/fleet/drivers/${driverId}/devices/reset`, {});

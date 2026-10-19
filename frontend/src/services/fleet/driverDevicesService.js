import { get, post } from "../apiClient";

/**
 * The phones a driver signs in on (backend fleet/driverDevices.controller.js).
 * One is trusted; others wait for a recovery code or for the office.
 * All of it needs driver.device.manage.
 */

/** Phones across the company waiting for the office: [{ deviceId, driverId, driverName, employeeNo, askedAt, locked }] */
export const getPendingDriverDevices = () =>
  get("/fleet/driver-devices/pending").then((r) => r.data || []);

/** { devices: [{ id, status, userAgent, approvedVia, approvedBy, lastSeenAt, ... }], codesLeft, locked, failures } */
export const getDriverDevices = (driverId) =>
  get(`/fleet/drivers/${driverId}/devices`).then((r) => r.data);

/** Only after calling the driver on the number on file: the server refuses without confirmedByCall. */
export const approveDriverDevice = (driverId, deviceId) =>
  post(`/fleet/drivers/${driverId}/devices/${deviceId}/approve`, { confirmedByCall: true });

export const revokeDriverDevice = (driverId, deviceId) =>
  post(`/fleet/drivers/${driverId}/devices/${deviceId}/revoke`, {});

/** Every phone signed out, codes cancelled, lock lifted: the next sign-in sets up a trusted phone. */
export const resetDriverDevices = (driverId) =>
  post(`/fleet/drivers/${driverId}/devices/reset`, {});

/** A new set of codes to read to the driver. { recoveryCodes } */
export const newDriverRecoveryCodes = (driverId) =>
  post(`/fleet/drivers/${driverId}/devices/recovery-codes`, {}).then((r) => r.data);

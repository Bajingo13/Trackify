import { recordAudit } from "../../shared/audit.js";
import {
  approveByOffice, codesByOffice, listForOffice, pendingForOffice, resetByOffice, revokeByOffice,
} from "../driver-app/devices.service.js";

/*
 * The phones a driver signs in on, as the office sees them. Behind
 * driver.device.manage: approving a phone hands someone a driver's account, so
 * it is a narrower right than editing the driver's details.
 * See driver-app/devices.service.js for how a phone becomes trusted.
 */

const ids = (req) => ({
  companyId: req.context.companyId,
  driverId: Number(req.params.id),
  deviceId: req.params.deviceId !== undefined ? Number(req.params.deviceId) : undefined,
});

const fail = (res, result) => res.status(result.status).json({ success: false, message: result.error });

/** Every phone in the company waiting for approval — the bell's list. */
export async function pendingDevices(req, res) {
  res.json({ success: true, data: await pendingForOffice({ companyId: req.context.companyId }) });
}

export async function listDevices(req, res) {
  const data = await listForOffice(ids(req));
  if (!data) return res.status(404).json({ success: false, message: "Driver not found." });
  res.json({ success: true, data });
}

export async function approveDevice(req, res) {
  // The dialog asks for this. It is what makes an approval more than a click.
  if (req.body?.confirmedByCall !== true) {
    return res.status(400).json({
      success: false,
      message: "Call the driver on the number on file and confirm it is them before approving a new phone.",
    });
  }
  const { companyId, driverId, deviceId } = ids(req);
  const result = await approveByOffice({ companyId, driverId, deviceId, userId: req.user?.userId ?? null });
  if (result.error) return fail(res, result);
  await recordAudit(req, {
    module: "fleet", action: "driver.device.approved", entityType: "driver", entityId: driverId,
    summary: `Approved a new phone for driver #${driverId} after a call; the old phone was signed out`,
    metadata: { deviceId },
  });
  res.json({ success: true });
}

export async function revokeDevice(req, res) {
  const { companyId, driverId, deviceId } = ids(req);
  const result = await revokeByOffice({ companyId, driverId, deviceId });
  if (result.error) return fail(res, result);
  await recordAudit(req, {
    module: "fleet", action: "driver.device.revoked", entityType: "driver", entityId: driverId,
    summary: `Revoked a phone for driver #${driverId}`,
    metadata: { deviceId },
  });
  res.json({ success: true });
}

export async function resetDevices(req, res) {
  const { companyId, driverId } = ids(req);
  const result = await resetByOffice({ companyId, driverId });
  if (result.error) return fail(res, result);
  await recordAudit(req, {
    module: "fleet", action: "driver.device.reset", entityType: "driver", entityId: driverId,
    summary: `Reset phones and recovery codes for driver #${driverId}; their next sign-in sets up a new trusted phone`,
  });
  res.json({ success: true });
}

export async function newRecoveryCodes(req, res) {
  const { companyId, driverId } = ids(req);
  const result = await codesByOffice({ companyId, driverId });
  if (result.error) return fail(res, result);
  await recordAudit(req, {
    module: "fleet", action: "driver.device.codes_issued", entityType: "driver", entityId: driverId,
    summary: `Made a new set of recovery codes for driver #${driverId}`,
  });
  res.json({ success: true, data: { recoveryCodes: result.recoveryCodes } });
}

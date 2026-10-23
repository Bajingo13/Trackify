import { useCallback, useEffect, useRef, useState } from "react";
import { Smartphone } from "lucide-react";
import ConfirmDialog from "../shared/ConfirmDialog";
import { Modal, Button } from "../ui";
import { useToast } from "../shared/Toast";
import {
  approveDriverDevice, DEVICE_REQUESTS_CHANGED_EVENT, getDriverDevices, resetDriverDevices,
  revokeDriverDevice, unblockDriverDevice,
} from "../../services/fleet/driverDevicesService";

/**
 * The phones a driver signs in on, on the driver's page.
 *
 * A driver has one trusted phone. A sign-in from any other phone waits until
 * the driver enters the code emailed to them, or the office approves it here — after
 * calling the driver on the number on file, because approving a phone hands
 * that phone the driver's account.
 */

const STATUS = {
  active: { label: "Trusted", bg: "#DCFCE7", text: "#15803D" },
  pending: { label: "Waiting for approval", bg: "#FEF3C7", text: "#92400E" },
  revoked: { label: "Replaced", bg: "#F3F4F6", text: "#4B5563" },
  blocked: { label: "Signed out by office", bg: "#FEF2F2", text: "#B91C1C" },
};

const VIA = {
  first_device: "first sign-in",
  recovery_code: "recovery code",
  email_code: "emailed code",
  office: "office approval",
};

function when(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

/** "Android 14 · Chrome" from a user agent, or the raw text if nothing is recognised. */
function phoneName(ua) {
  const s = String(ua || "");
  if (!s) return "Unknown phone";
  const android = s.match(/Android [\d.]+/);
  const ios = s.match(/iPhone OS [\d_]+/);
  const os = android?.[0] || (ios ? ios[0].replace("iPhone OS", "iOS").replace(/_/g, ".") : null);
  const app = /wv\)/.test(s) ? "Trackify Driver app" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : null;
  return [os, app].filter(Boolean).join(" · ") || s.slice(0, 60);
}

export default function DriverDevicesCard({ driver, focus = false }) {
  const { addToast } = useToast();
  const cardRef = useRef(null);
  // Opened from a phone request in the bell: bring the phones into view.
  useEffect(() => {
    if (focus) cardRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [focus]);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState(null); // { kind, device? }
  const [called, setCalled] = useState(false);

  const load = useCallback(() => {
    setErr("");
    getDriverDevices(driver.id).then(setData).catch((e) => setErr(e.message));
  }, [driver.id]);
  useEffect(load, [load]);

  async function run(action, success) {
    try {
      const result = await action();
      addToast(success, "success");
      return result;
    } catch (e) {
      addToast(e.message || "That didn't work", "error");
      return null;
    } finally {
      setConfirm(null);
      setCalled(false);
      load();
      // the bell drops (or keeps) the request without waiting for its poll
      window.dispatchEvent(new Event(DEVICE_REQUESTS_CHANGED_EVENT));
    }
  }

  const name = `${driver.firstName} ${driver.lastName}`.trim();
  const devices = data?.devices || [];

  return (
    <div ref={cardRef} className="ops-card" style={{ padding: 20, marginTop: 16, scrollMarginTop: 80 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Smartphone size={15} />
        <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--trackify-text-secondary)", margin: 0, textTransform: "uppercase" }}>Driver App phones</h4>
        {data?.email && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--trackify-text-secondary)" }}>
            Sign-in codes go to {data.email}
          </span>
        )}
      </div>

      {err && <div style={{ fontSize: 13, color: "#B91C1C" }}>{err}</div>}
      {data && !data.email && (
        <div style={{ fontSize: 13, background: "var(--warn-soft)", color: "var(--warn)", padding: 10, borderRadius: 8, marginBottom: 12 }}>
          No email on file. {driver.firstName} can&rsquo;t receive sign-in codes, so every new phone needs your approval.
          Add an email with <b>Edit</b>.
        </div>
      )}
      {data?.locked && (
        <div style={{ fontSize: 13, background: "#FEF2F2", color: "#B91C1C", padding: 10, borderRadius: 8, marginBottom: 12 }}>
          Locked after too many wrong codes. Approve the waiting phone after calling the driver, or reset their phones.
        </div>
      )}

      {data && !devices.length && (
        <div style={{ fontSize: 13, color: "var(--trackify-text-muted)", padding: 12, textAlign: "center" }}>
          No phone set up yet. The first phone {driver.firstName} signs in on becomes their trusted phone.
        </div>
      )}

      {devices.length > 0 && (
        <table className="ops-table" style={{ margin: 0 }}>
          <thead><tr><th>Phone</th><th>Status</th><th>Last seen</th><th>Trusted by</th><th /></tr></thead>
          <tbody>
            {devices.map((d) => {
              // A waiting phone whose driver hasn't asked the office is most likely reading their email.
              const s = d.status === "pending" && !d.officeRequestedAt && data?.email
                ? { ...STATUS.pending, label: "Waiting for emailed code" }
                : d.status === "pending" && d.officeRequestedAt
                  ? { ...STATUS.pending, label: "Asked the office to approve" }
                  : STATUS[d.status] || STATUS.revoked;
              return (
                <tr key={d.id}>
                  <td style={{ fontSize: 13 }} title={d.userAgent || ""}>{phoneName(d.userAgent)}</td>
                  <td><span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: s.bg, color: s.text }}>{s.label}</span></td>
                  <td style={{ fontSize: 13 }}>{when(d.lastSeenAt)}</td>
                  <td style={{ fontSize: 13 }}>
                    {d.status === "revoked" || d.status === "blocked" ? (d.revokedReason || "—") : d.approvedVia ? `${VIA[d.approvedVia] || d.approvedVia}${d.approvedBy ? ` (${d.approvedBy})` : ""}` : "—"}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {d.status === "pending" && (
                      <button className="ops-btn ops-btn-primary" onClick={() => setConfirm({ kind: "approve", device: d })}>Approve</button>
                    )}
                    {d.status !== "blocked" && (
                      <button className="ops-btn ops-btn-ghost" style={{ marginLeft: 6 }} onClick={() => setConfirm({ kind: "revoke", device: d })}>
                        {d.status === "pending" ? "Refuse" : "Sign out"}
                      </button>
                    )}
                    {d.status === "blocked" && (
                      <button className="ops-btn ops-btn-ghost" style={{ marginLeft: 6 }} onClick={() => setConfirm({ kind: "unblock", device: d })}>
                        Allow again
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button className="ops-btn ops-btn-ghost" onClick={() => setConfirm({ kind: "reset" })}>Reset phones</button>
      </div>

      {/* Approving hands a phone the driver's account: it needs a call, not just a click. */}
      <Modal
        open={confirm?.kind === "approve"}
        softBackdrop
        title={`Approve a new phone for ${name}?`}
        onClose={() => { setConfirm(null); setCalled(false); }}
        width={460}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setConfirm(null); setCalled(false); }}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!called}
              onClick={() => run(() => approveDriverDevice(driver.id, confirm.device.id), "New phone approved. The old phone was signed out.")}
            >
              Approve phone
            </Button>
          </>
        }
      >
        <p style={{ fontSize: 13.5, margin: "0 0 12px", lineHeight: 1.55 }}>
          Call {driver.firstName} on <b>{driver.contactNo || "the number on file"}</b> and confirm they are signing in on a new phone
          right now. Don&rsquo;t approve a phone because someone asks you to over chat or from another number.
        </p>
        <label style={{ display: "flex", gap: 8, fontSize: 13, alignItems: "flex-start" }}>
          <input type="checkbox" checked={called} onChange={(e) => setCalled(e.target.checked)} />
          I called the driver on their registered number and they confirmed it&rsquo;s them.
        </label>
      </Modal>

      <ConfirmDialog
        open={confirm?.kind === "revoke"}
        danger
        title={confirm?.device?.status === "pending" ? "Refuse this phone?" : "Sign this phone out?"}
        message={confirm?.device?.status === "pending"
          ? "This phone can never sign in to this account again, even with the right PIN. Do this for a phone you don't recognise."
          : `${driver.firstName} is signed out on this phone straight away, and it can't sign in again, even with the PIN. Their next phone needs the emailed code or your approval. If the phone was stolen, also change their PIN.`}
        confirmLabel={confirm?.device?.status === "pending" ? "Refuse" : "Sign out phone"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => run(() => revokeDriverDevice(driver.id, confirm.device.id), "Phone signed out")}
      />

      <ConfirmDialog
        open={confirm?.kind === "unblock"}
        title="Allow this phone again?"
        message={`This phone may sign in to ${driver.firstName}'s account again, but it is not trusted yet: when ${driver.firstName} signs in on it, it waits for the emailed code or your approval, like any new phone.`}
        confirmLabel="Allow again"
        onCancel={() => setConfirm(null)}
        onConfirm={() => run(() => unblockDriverDevice(driver.id, confirm.device.id), "Phone allowed again. It needs a code or your approval on its next sign-in.")}
      />

      <ConfirmDialog
        open={confirm?.kind === "reset"}
        danger
        title={`Reset ${name}'s phones?`}
        message={data?.email
          ? `Every phone is signed out. The next phone ${driver.firstName} signs in on becomes their trusted phone once they enter the code emailed to ${data.email}. Phones you signed out stay blocked.`
          : `Every phone is signed out. ${driver.firstName} has no email on file, so the next phone they sign in on becomes their trusted phone with the PIN alone: only do this while they are about to sign in. Phones you signed out stay blocked.`}
        confirmLabel="Reset phones"
        onCancel={() => setConfirm(null)}
        onConfirm={() => run(() => resetDriverDevices(driver.id), "Phones reset")}
      />
    </div>
  );
}

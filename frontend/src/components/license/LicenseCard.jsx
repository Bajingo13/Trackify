import { useState } from "react";
import { Bell, BellRing, Check, Clipboard } from "lucide-react";
import { Button } from "../ui";
import LicenseBadge from "./LicenseBadge";
import { LICENSE_STATES, describeStatus, formatDate, reminderParts, termUsed } from "./licenseDisplay";

/**
 * A license in one grouped surface, top to bottom in the order people look:
 *
 *   header      who it belongs to, and its status
 *   number      the thing read out when calling support, with Copy
 *   validity    one plain sentence, three dates, and how much of the term is used
 *   reminder    whether the client has already been warned — its own box, so it
 *               is not lost among the dates
 */

const label = { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)" };

function Tile({ title, value, note }) {
  return (
    <div style={{ padding: "7px 12px", borderRadius: "var(--r-md)", background: "var(--surface-sunk)", minWidth: 104, flex: "0 1 auto" }}>
      <div style={label}>{title}</div>
      <div style={{ marginTop: 1, fontSize: "var(--fs-14)", fontWeight: 700, color: "var(--text)", overflowWrap: "anywhere" }}>{value}</div>
      {note && <div style={{ marginTop: 1, fontSize: 11.5, color: "var(--text-2)" }}>{note}</div>}
    </div>
  );
}

export default function LicenseCard({ license, companyName }) {
  const [copied, setCopied] = useState(false);
  const used = termUsed(license);
  const tone = (LICENSE_STATES[license.state] || LICENSE_STATES.missing).color;
  const reminder = reminderParts(license);

  async function copy() {
    try {
      await navigator.clipboard.writeText(license.licenseNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked: the number is still selectable on screen */ }
  }

  const timeLeft = license.perpetual ? "No expiry" : license.state === "expired" ? "Ended" : `${license.daysRemaining} day${license.daysRemaining === 1 ? "" : "s"}`;

  return (
    <section
      aria-label="License"
      style={{
        background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-1)", overflow: "hidden", maxWidth: 540,
      }}
    >
      <header
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
          padding: "10px 14px", borderBottom: "1px solid var(--line-soft)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: "var(--text)", overflowWrap: "anywhere" }}>{companyName || license.companyName || "License"}</div>
          {license.systemCode && <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>System {license.systemCode}</div>}
        </div>
        <LicenseBadge state={license.state} />
      </header>

      {license.licenseNumber && (
        <div style={{ display: "grid", gap: 13, padding: 14 }}>
          <div>
            <div style={label}>License number</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
              <code
                data-testid="license-number"
                style={{
                  padding: "6px 10px", borderRadius: "var(--r-sm)", background: "var(--surface-sunk)", border: "1px solid var(--line-soft)",
                  fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, letterSpacing: "0.04em",
                  flex: "0 1 auto", minWidth: 0, overflowWrap: "anywhere", userSelect: "all",
                }}
              >
                {license.licenseNumber}
              </code>
              <Button type="button" variant="secondary" size="sm" icon={copied ? Check : Clipboard} onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          <div>
            <div style={label}>Validity</div>
            <p style={{ margin: "5px 0 8px", fontSize: "var(--fs-13)", fontWeight: 600, color: tone }}>{describeStatus(license)}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Tile title="Issued" value={formatDate(license.issuedAt)} />
              <Tile title="Valid until" value={license.perpetual ? "No end date" : formatDate(license.expiresAt)} />
              {license.state !== "revoked" && <Tile title="Time left" value={timeLeft} note={license.perpetual ? "This license never expires" : license.state === "expired" ? "Renewal needed" : "until the end date"} />}
            </div>
            {used !== null && (
              <div style={{ marginTop: 10 }}>
                <div
                  role="progressbar" aria-label="License term used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={used}
                  style={{ height: 6, borderRadius: 3, background: "var(--surface-sunk)", overflow: "hidden" }}
                >
                  <div style={{ width: `${used}%`, height: "100%", background: tone, borderRadius: 3 }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 5, fontSize: 11.5, color: "var(--text-3)" }}>
                  <span>{formatDate(license.issuedAt)}</span>
                  <span style={{ color: "var(--text-2)" }}>{used}% of the license term used</span>
                  <span>{formatDate(license.expiresAt)}</span>
                </div>
              </div>
            )}
          </div>

          {reminder && (
            <div
              style={{
                display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 12px", borderRadius: "var(--r-md)", justifySelf: "start", maxWidth: "100%",
                background: reminder.kind === "pending" ? "var(--warn-soft)" : "var(--surface-sunk)",
                borderLeft: `3px solid ${reminder.kind === "sent" ? "var(--ok)" : reminder.kind === "pending" ? "var(--warn)" : "var(--line-strong)"}`,
              }}
            >
              {reminder.kind === "sent"
                ? <BellRing size={18} aria-hidden="true" style={{ color: "var(--ok)", flexShrink: 0, marginTop: 1 }} />
                : <Bell size={18} aria-hidden="true" style={{ color: reminder.kind === "pending" ? "var(--warn)" : "var(--text-3)", flexShrink: 0, marginTop: 1 }} />}
              <div style={{ minWidth: 0 }}>
                <div style={label}>Last reminder</div>
                {reminder.kind === "sent" ? (
                  <>
                    <div style={{ marginTop: 3, fontWeight: 700, color: "var(--text)" }}>{reminder.label} sent</div>
                    <div style={{ marginTop: 1, fontSize: 12.5, color: "var(--text-2)" }}>
                      {reminder.when}{reminder.to ? ` · ${reminder.to}` : ""}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ marginTop: 3, fontWeight: 700, color: "var(--text)" }}>{reminder.label}</div>
                    <div style={{ marginTop: 1, fontSize: 12.5, color: "var(--text-2)" }}>
                      {reminder.kind === "notDue"
                        ? "The first email goes to the company's administrators 30 days before the end date."
                        : "A reminder is due and goes out with the next daily check."}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {license.message && (
        <p role="status" style={{ margin: 0, padding: "8px 14px", borderTop: "1px solid var(--line-soft)", fontSize: "var(--fs-13)", color: tone }}>
          {license.message}
          {license.state === "revoked" && license.revokedReason ? ` Reason: ${license.revokedReason}` : ""}
        </p>
      )}
    </section>
  );
}

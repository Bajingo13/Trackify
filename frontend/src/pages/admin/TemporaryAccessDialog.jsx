import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { MailCheck, KeyRound, X, Mail, Clock, ShieldCheck, Copy, Check, AlertTriangle, Link2 } from "lucide-react";
import { Button } from "../../components/ui";
import { scaleIn, backdrop } from "../../motion";

const tint = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

function formatExpiry(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { absolute: "—", relative: "" };
  const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  const hours = Math.round((date.getTime() - Date.now()) / 3_600_000);
  let relative = "";
  if (hours >= 48) relative = `in ${Math.round(hours / 24)} days`;
  else if (hours >= 1) relative = `in ${hours} hour${hours === 1 ? "" : "s"}`;
  else if (hours >= 0) relative = "within the hour";
  return { absolute, relative };
}

function DetailRow({ icon: Icon, label, children }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 14px" }}>
      <Icon size={15} style={{ flexShrink: 0, marginTop: 2, color: "var(--text-3)" }} aria-hidden="true" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 2 }}>
          {label}
        </div>
        <div style={{ fontSize: 13.5, color: "var(--text)", overflowWrap: "anywhere" }}>{children}</div>
      </div>
    </div>
  );
}

/* Wording for the two handovers: a temporary password, or an account invitation. */
const COPY = {
  temporary: {
    sentTitle: "Temporary access sent",
    shownTitle: "Temporary password created",
    sent: "A one-time password is on its way to",
    sentTail: "You don’t need to share anything.",
    shown: "Share this password with",
    shownTail: "in person or over a secure channel. It is shown only once.",
    secretLabel: "Temporary password",
    note: "They’ll be asked to create a permanent password the first time they sign in.",
    shownDone: "I’ve shared it securely",
  },
  invite: {
    sentTitle: "Invitation sent",
    shownTitle: "Invitation link created",
    sent: "An invitation is on its way to",
    sentTail: "They’ll confirm their name and choose their own password — you won’t see it.",
    shown: "Share this link with",
    shownTail: "by message or chat. It opens their account setup and works only once.",
    secretLabel: "Invitation link",
    note: "The link works once. Sending a new invitation cancels this one.",
    shownDone: "I’ve shared the link",
  },
};

/**
 * The handover after issuing temporary access or sending an invitation:
 * centred, and one of two shapes. Emailed — confirm where it went and when it
 * lapses. Not emailed — the password or link itself, once, with a copy button
 * and the reason email failed.
 */
export default function TemporaryAccessDialog({ access, onClose, onCopy, kind = "temporary" }) {
  const titleId = useId();
  const descId = useId();
  const [copied, setCopied] = useState(false);
  const emailed = access.delivery === "email";
  const expiry = formatExpiry(access.expiresAt);
  const who = access.name || access.email;
  const text = COPY[kind] || COPY.temporary;
  const invite = kind === "invite";
  const secret = invite ? access.inviteUrl : access.temporaryPassword;

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  async function copy() {
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const accent = emailed ? "var(--ok)" : "var(--accent)";
  const HeroIcon = emailed ? MailCheck : invite ? Link2 : KeyRound;

  return createPortal(
    <motion.div
      className="tk-scope"
      variants={backdrop}
      initial="hidden"
      animate="show"
      exit="exit"
      onMouseDown={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        background: "rgba(15, 23, 42, 0.2)", WebkitBackdropFilter: "blur(8px)", backdropFilter: "blur(8px)",
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        variants={scaleIn}
        initial="hidden"
        animate="show"
        exit="exit"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: "relative", width: "100%", maxWidth: 440, maxHeight: "calc(100vh - 32px)", overflowY: "auto",
          background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-xl, 16px)",
          boxShadow: "var(--shadow-3)", padding: "28px 28px 24px",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute", top: 14, right: 14, display: "inline-flex", padding: 6, border: "none",
            background: "transparent", cursor: "pointer", color: "var(--text-3)", borderRadius: "var(--r-sm)",
          }}
        >
          <X size={16} />
        </button>

        <div
          aria-hidden="true"
          style={{
            width: 48, height: 48, borderRadius: 14, display: "grid", placeItems: "center", marginBottom: 16,
            color: accent, background: tint(accent, 12), boxShadow: `0 0 0 6px ${tint(accent, 6)}`,
          }}
        >
          <HeroIcon size={22} strokeWidth={2} />
        </div>

        <h2 id={titleId} style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--text)" }}>
          {emailed ? text.sentTitle : text.shownTitle}
        </h2>
        <p id={descId} style={{ margin: "0 0 20px", fontSize: 13.5, lineHeight: 1.55, color: "var(--text-2)" }}>
          {emailed ? (
            <>{text.sent} <strong style={{ color: "var(--text)" }}>{who}</strong>. {text.sentTail}</>
          ) : (
            <>{text.shown} <strong style={{ color: "var(--text)" }}>{who}</strong> {text.shownTail}</>
          )}
        </p>

        {!emailed && access.deliveryProblem && (
          <div
            role="status"
            style={{
              display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", marginBottom: 14,
              borderRadius: "var(--r-md)", background: tint("var(--warn)", 10), color: "var(--text)", fontSize: 12.5, lineHeight: 1.5,
            }}
          >
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1, color: "var(--warn)" }} aria-hidden="true" />
            <span>{access.deliveryProblem}</span>
          </div>
        )}

        {!emailed && (
          <div
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "6px 6px 6px 14px", marginBottom: 14,
              borderRadius: "var(--r-md)", border: "1px solid var(--line-strong)", background: "var(--surface-sunk)",
            }}
          >
            <code
              aria-label={text.secretLabel}
              style={{
                flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text)", overflowWrap: "anywhere",
                ...(invite ? { fontSize: 12, lineHeight: 1.45 } : { fontSize: 16, letterSpacing: "0.03em" }),
              }}
            >
              {secret}
            </code>
            <Button variant="secondary" size="sm" icon={copied ? Check : Copy} onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        )}

        <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r-md)", background: "var(--surface-2)", marginBottom: 16 }}>
          <DetailRow icon={Mail} label={emailed ? "Sent to" : "Account"}>{access.email}</DetailRow>
          <div style={{ height: 1, background: "var(--line)", margin: "0 14px" }} />
          <DetailRow icon={Clock} label="Expires">
            {expiry.absolute}
            {expiry.relative && <span style={{ color: "var(--text-3)" }}> · {expiry.relative}</span>}
          </DetailRow>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, lineHeight: 1.5, color: "var(--text-3)", marginBottom: 22 }}>
          <ShieldCheck size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
          <span>{text.note}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="primary" onClick={onClose} autoFocus style={{ minWidth: 96 }}>
            {emailed ? "Done" : text.shownDone}
          </Button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "../ui";
import { useAuth } from "../../context/AuthContext";
import { loadAgreement, acceptAgreement } from "../../services/agreementService";

/**
 * Nothing in the system opens until the Agreement is accepted.
 *
 * Section 2.1 says an account is not activated until the user has reviewed and
 * accepted, so this sits inside the authenticated route guard rather than on a
 * page of its own — there is no way to navigate around it, because every
 * protected route passes through here.
 *
 * It fails closed. If the acceptance state cannot be read the application does
 * not open, because letting someone in on the assumption they probably accepted
 * is precisely the record this exists to keep. They are given a retry and a way
 * to sign out rather than a dead end.
 */
export default function AgreementGate({ children }) {
  const { logout } = useAuth();
  const [state, setState] = useState({ status: "loading" });

  const fetchAgreement = useCallback(() => {
    setState({ status: "loading" });
    loadAgreement()
      .then((doc) => setState({ status: doc.accepted ? "accepted" : "review", doc }))
      .catch((err) => setState({ status: "error", error: err.message }));
  }, []);

  useEffect(fetchAgreement, [fetchAgreement]);

  if (state.status === "accepted") return children;

  if (state.status === "loading") {
    return (
      <div role="status" className="app-route-loading">
        Loading Trackify…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <Shell>
        <h1 style={titleStyle}>We could not check your agreement status</h1>
        <p style={bodyStyle}>
          The system cannot confirm whether you have accepted the Terms of Service
          and Data Privacy Policy, so it has not opened. {state.error}
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: "var(--s-5)" }}>
          <Button onClick={fetchAgreement}>Try again</Button>
          <Button variant="secondary" onClick={logout}>Sign out</Button>
        </div>
      </Shell>
    );
  }

  return <Review doc={state.doc} onAccepted={() => setState({ status: "accepted" })} onDecline={logout} />;
}

function Review({ doc, onAccepted, onDecline }) {
  const [read, setRead] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const scroller = useRef(null);

  /**
   * "You must review and accept" — so Accept stays disabled until the document
   * has actually been scrolled through. A short viewport that shows the whole
   * text counts as read immediately, which is why this also runs on mount.
   */
  const checkRead = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    if (atEnd) setRead(true);
  }, []);

  useEffect(checkRead, [checkRead, doc]);

  async function onAccept() {
    setSaving(true);
    setErr("");
    try {
      await acceptAgreement();
      onAccepted();
    } catch (e) {
      setErr(e.message || "Your acceptance could not be recorded. Please try again.");
      setSaving(false);
    }
  }

  return (
    <Shell wide>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 34, height: 34, borderRadius: 9, flexShrink: 0,
            background: "var(--accent-soft)", color: "var(--accent)",
            display: "grid", placeItems: "center",
          }}
        >
          <ShieldCheck size={18} />
        </span>
        <div>
          <h1 style={{ ...titleStyle, margin: 0 }}>{doc.title}</h1>
          <p style={{ margin: 0, fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
            {doc.systemName} · Version {doc.version} · Last updated{" "}
            {new Date(doc.effectiveDate).toLocaleDateString(undefined, {
              day: "numeric", month: "long", year: "numeric",
            })}
          </p>
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={checkRead}
        tabIndex={0}
        role="region"
        aria-label="Agreement text"
        style={{
          marginTop: "var(--s-4)",
          maxHeight: "50vh",
          overflowY: "auto",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-md, 10px)",
          background: "var(--surface-2)",
          padding: "var(--s-4)",
          fontSize: "var(--fs-13)",
          lineHeight: 1.6,
          color: "var(--text-2)",
        }}
      >
        <p style={{ marginTop: 0 }}>{doc.intro}</p>

        {doc.sections.map((section, i) => (
          <section key={section.heading} style={{ marginTop: i === 0 ? "var(--s-4)" : "var(--s-5)" }}>
            <h2
              style={{
                margin: "0 0 var(--s-2)", fontSize: "var(--fs-13)", fontWeight: 700,
                color: "var(--text)", textTransform: "uppercase", letterSpacing: ".04em",
              }}
            >
              {section.heading}
            </h2>
            {(section.paragraphs || []).map((p) => (
              <p key={p} style={{ margin: "0 0 var(--s-2)" }}>{p}</p>
            ))}
            {section.items && (
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
                {section.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}
          </section>
        ))}
      </div>

      <p style={{ ...bodyStyle, marginTop: "var(--s-4)", fontWeight: 600, color: "var(--text)" }}>
        {doc.acceptanceStatement}
      </p>

      {!read && (
        <p style={{ margin: "var(--s-2) 0 0", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
          Scroll to the end of the Agreement to continue.
        </p>
      )}

      {err && (
        <div
          style={{
            marginTop: "var(--s-3)", padding: "8px 12px", borderRadius: 8,
            background: "var(--danger-soft, #fbeaea)", color: "var(--danger, #c23b3b)",
            fontSize: "var(--fs-13)",
          }}
        >
          {err}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: "var(--s-5)", flexWrap: "wrap" }}>
        <Button onClick={onAccept} disabled={!read || saving}>
          {saving ? "Recording…" : "I have read and accept"}
        </Button>
        {/* Declining is not a refusal to be handled quietly: the Agreement says
            a user who does not agree must discontinue use, so it signs out. */}
        <Button variant="secondary" onClick={onDecline} disabled={saving}>
          I do not agree — sign out
        </Button>
      </div>
    </Shell>
  );
}

const titleStyle = {
  margin: 0,
  fontSize: "var(--fs-18)",
  fontWeight: 700,
  color: "var(--text)",
  letterSpacing: "-.01em",
};

const bodyStyle = {
  margin: "var(--s-3) 0 0",
  fontSize: "var(--fs-13)",
  lineHeight: 1.6,
  color: "var(--text-2)",
};

function Shell({ children, wide = false }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "var(--s-5)",
        background: "var(--surface-sunk, var(--surface-2))",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: wide ? 760 : 520,
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-lg, 14px)",
          padding: "var(--s-6, 24px)",
          boxShadow: "0 10px 30px -18px rgba(12, 26, 56, .25)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

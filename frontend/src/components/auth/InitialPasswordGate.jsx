import { useState } from "react";
import { KeyRound } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { Button } from "../ui";

export default function InitialPasswordGate({ children }) {
  const { user, completeInitialPassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (!user?.mustChangePassword) return children;

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError("The two passwords do not match.");
      return;
    }
    setSaving(true);
    const result = await completeInitialPassword(password);
    if (!result.success) setError(result.error);
    setSaving(false);
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--bg, #f4f7fb)" }}>
      <section style={{ width: "min(460px, 100%)", padding: 32, borderRadius: 16, background: "var(--surface, #fff)", boxShadow: "0 18px 50px rgba(15,23,42,.12)" }}>
        <KeyRound size={34} color="var(--primary, #315efb)" aria-hidden="true" />
        <h1 style={{ margin: "16px 0 8px" }}>Create your permanent password</h1>
        <p style={{ color: "var(--text-2, #64748b)", lineHeight: 1.55 }}>
          You signed in with a temporary password. Replace it before entering Trackify. Use at least 10 characters and do not reuse the temporary password.
        </p>
        <form onSubmit={submit} style={{ display: "grid", gap: 16, marginTop: 24 }}>
          <label>
            <span style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>New password</span>
            <input aria-label="New password" className="ops-form-input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
          </label>
          <label>
            <span style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Repeat new password</span>
            <input aria-label="Repeat new password" className="ops-form-input" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required minLength={10} />
          </label>
          {error && <div role="alert" style={{ color: "#b91c1c", fontSize: 14 }}>{error}</div>}
          <Button type="submit" variant="primary" loading={saving}>Activate account</Button>
        </form>
      </section>
    </main>
  );
}

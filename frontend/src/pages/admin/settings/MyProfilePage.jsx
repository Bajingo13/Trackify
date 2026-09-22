import { useCallback, useEffect, useRef, useState } from "react";
import {
  User, Mail, ShieldCheck, Building2, MapPin, Camera, Trash2, KeyRound, Save, X,
} from "lucide-react";
import { Card, Button, Field, inputStyle } from "../../../components/ui";
import { SettingsPage, FormSection } from "../../../components/settings";
import { useToast } from "../../../components/shared/Toast";
import { useAuth } from "../../../context/AuthContext";
import useMediaQuery from "../../../hooks/useMediaQuery";
import useActiveAccess from "../../../hooks/useActiveAccess";
import {
  updateMyProfile, changeMyPassword, getMyPhoto, uploadMyPhoto, removeMyPhoto,
} from "../../../services/admin/accountService";

/**
 * Your own account.
 *
 * This page used to be read-only: a card of facts, a camera button that
 * toasted "not available yet", and a line at the bottom telling you to ask an
 * administrator. With no password reset anywhere in the system — there is no
 * mailer — that meant nobody could change their own password at all.
 *
 * The name and the photograph save on their own. The email and the password
 * ask for the current password first, because a token lifted from an unlocked
 * screen must not be enough to move the account somewhere the owner cannot
 * follow.
 */

function Pill({ children }) {
  return (
    <span
      style={{
        padding: "3px 10px", borderRadius: "var(--r-pill)", fontSize: "var(--fs-11)", fontWeight: 600,
        background: "var(--accent-soft)", color: "var(--accent-ink)", border: "1px solid var(--line)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function ProfileRow({ icon: Icon, label, value, children, last }) {
  return (
    <div
      style={{
        display: "grid", gridTemplateColumns: "minmax(120px, 160px) 1fr", gap: "var(--s-4)",
        alignItems: "center", padding: "12px 0",
        borderBottom: last ? "none" : "1px solid var(--line-soft)",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "var(--fs-12)", fontWeight: 600, color: "var(--text-3)" }}>
        <Icon size={14} style={{ flexShrink: 0 }} />
        {label}
      </span>
      <span style={{ fontSize: "var(--fs-13)", color: "var(--text)", minWidth: 0 }}>{children ?? value}</span>
    </div>
  );
}

export default function MyProfilePage() {
  const { user, refresh } = useAuth();
  const { addToast } = useToast();
  const stacked = useMediaQuery("(max-width: 820px)");
  const { current: access } = useActiveAccess();
  const fileRef = useRef(null);

  const [photo, setPhoto] = useState(null);
  const [busyPhoto, setBusyPhoto] = useState(false);

  const [details, setDetails] = useState({ firstName: "", lastName: "", email: "", currentPassword: "" });
  const [savingDetails, setSavingDetails] = useState(false);

  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    setDetails((d) => ({
      ...d,
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
      email: user?.email || "",
    }));
  }, [user?.firstName, user?.lastName, user?.email]);

  const loadPhoto = useCallback(async () => {
    try {
      setPhoto(await getMyPhoto());
    } catch {
      /* the initial avatar is not worth an error message */
    }
  }, []);

  useEffect(() => {
    loadPhoto();
  }, [loadPhoto]);

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "—";
  const roles = (user?.roles || []).map((r) => r.role_name).filter(Boolean);
  const initial = user?.firstName?.[0]?.toUpperCase() || "U";

  const emailChanged =
    details.email.trim().toLowerCase() !== String(user?.email || "").toLowerCase();
  const detailsChanged =
    emailChanged ||
    details.firstName.trim() !== (user?.firstName || "") ||
    details.lastName.trim() !== (user?.lastName || "");

  async function pickPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // so choosing the same file again still fires
    if (!file) return;

    setBusyPhoto(true);
    try {
      await uploadMyPhoto(file);
      await loadPhoto();
      addToast("Photo updated.", "success");
    } catch (error) {
      addToast(error.message || "Could not upload that photo.", "error");
    } finally {
      setBusyPhoto(false);
    }
  }

  async function dropPhoto() {
    setBusyPhoto(true);
    try {
      await removeMyPhoto();
      setPhoto(null);
      addToast("Photo removed.", "success");
    } catch (error) {
      addToast(error.message || "Could not remove that photo.", "error");
    } finally {
      setBusyPhoto(false);
    }
  }

  async function saveDetails() {
    setSavingDetails(true);
    try {
      const payload = {
        firstName: details.firstName.trim(),
        lastName: details.lastName.trim(),
        email: details.email.trim(),
      };
      if (emailChanged) payload.currentPassword = details.currentPassword;

      const res = await updateMyProfile(payload);
      await refresh();
      setDetails((d) => ({ ...d, currentPassword: "" }));
      addToast(res.message || "Saved.", "success");
    } catch (error) {
      addToast(error.message || "Could not save your details.", "error");
    } finally {
      setSavingDetails(false);
    }
  }

  async function savePassword() {
    if (pw.newPassword !== pw.confirm) {
      addToast("The two new passwords do not match.", "error");
      return;
    }
    setSavingPw(true);
    try {
      const res = await changeMyPassword(pw.currentPassword, pw.newPassword);
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
      addToast(res.message || "Password changed.", "success");
    } catch (error) {
      addToast(error.message || "Could not change your password.", "error");
    } finally {
      setSavingPw(false);
    }
  }

  const rolePills = roles.length ? (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6 }}>
      {roles.map((r) => <Pill key={r}>{r}</Pill>)}
    </span>
  ) : "—";

  return (
    <SettingsPage
      eyebrow="Account"
      title="My Profile"
      description="Your account details, your photo and your password."
    >
      <Card pad="0" style={{ overflow: "hidden", marginBottom: "var(--s-4)" }}>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {/* identity */}
          <div
            style={{
              flex: "0 1 360px", minWidth: 260, display: "flex", alignItems: "center", gap: "var(--s-4)",
              padding: "var(--s-6)",
            }}
          >
            <div style={{ position: "relative", flexShrink: 0 }}>
              {photo ? (
                <img
                  src={photo}
                  alt=""
                  style={{ width: 88, height: 88, borderRadius: "50%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <span
                  style={{
                    width: 88, height: 88, borderRadius: "50%", display: "grid", placeItems: "center",
                    background: "linear-gradient(135deg, var(--brand-blue), var(--brand-navy))",
                    color: "#fff", fontSize: "var(--fs-26)", fontWeight: 700,
                  }}
                >
                  {initial}
                </span>
              )}

              <input
                ref={fileRef}
                id="profile-photo"
                type="file"
                accept="image/*"
                onChange={pickPhoto}
                style={{ display: "none" }}
              />
              <button
                type="button"
                aria-label="Change photo"
                disabled={busyPhoto}
                onClick={() => fileRef.current?.click()}
                style={{
                  position: "absolute", right: -2, bottom: -2, width: 28, height: 28, borderRadius: "50%",
                  background: "var(--accent)", color: "var(--text-on-accent)", border: "3px solid var(--surface)",
                  display: "grid", placeItems: "center", cursor: busyPhoto ? "progress" : "pointer",
                }}
              >
                <Camera size={13} />
              </button>
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "var(--fs-18)", fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" }}>
                {fullName}
              </div>
              <div style={{ fontSize: "var(--fs-12)", color: "var(--text-3)", margin: "2px 0 8px", overflowWrap: "anywhere" }}>
                {user?.email || "—"}
              </div>
              {rolePills}
              {photo && (
                <div style={{ marginTop: 10 }}>
                  <Button variant="ghost" size="sm" icon={Trash2} disabled={busyPhoto} onClick={dropPhoto}>
                    Remove photo
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* details */}
          <div
            style={{
              flex: "1 1 380px", minWidth: 300, padding: "var(--s-5) var(--s-6)",
              borderLeft: stacked ? "none" : "1px solid var(--line)",
              borderTop: stacked ? "1px solid var(--line)" : "none",
            }}
          >
            <ProfileRow icon={ShieldCheck} label="Role">{rolePills}</ProfileRow>
            <ProfileRow icon={Building2} label="Company" value={access?.company_name || "—"} />
            <ProfileRow icon={MapPin} label="Branch" value={access?.branch_name || "—"} last />
          </div>
        </div>
      </Card>

      <FormSection
        title="Your details"
        description="Your name as it appears on trip tickets and in the audit log, and the address you sign in with."
        actions={
          <Button
            variant="primary"
            icon={Save}
            loading={savingDetails}
            disabled={!detailsChanged || (emailChanged && !details.currentPassword)}
            onClick={saveDetails}
          >
            Save details
          </Button>
        }
      >
        <div style={{ display: "flex", gap: "var(--s-4)", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 200px", minWidth: 180 }}>
            <Field label="First name">
              <input
                id="first-name"
                value={details.firstName}
                onChange={(e) => setDetails({ ...details, firstName: e.target.value })}
                maxLength={100}
                style={inputStyle}
              />
            </Field>
          </div>
          <div style={{ flex: "1 1 200px", minWidth: 180 }}>
            <Field label="Last name">
              <input
                id="last-name"
                value={details.lastName}
                onChange={(e) => setDetails({ ...details, lastName: e.target.value })}
                maxLength={100}
                style={inputStyle}
              />
            </Field>
          </div>
        </div>

        <Field
          label="Email"
          hint="This is what you sign in with. Changing it asks for your password below."
        >
          <input
            id="email"
            type="email"
            aria-label="Email"
            value={details.email}
            onChange={(e) => setDetails({ ...details, email: e.target.value })}
            autoComplete="username"
            style={inputStyle}
          />
        </Field>

        {/* Only asked for when it is actually needed. */}
        {emailChanged && (
          <Field
            label="Current password"
            hint="Needed to change the address you sign in with."
          >
            <input
              id="email-current-password"
              type="password"
              aria-label="Current password to change your email"
              value={details.currentPassword}
              onChange={(e) => setDetails({ ...details, currentPassword: e.target.value })}
              autoComplete="current-password"
              style={inputStyle}
            />
          </Field>
        )}

        {detailsChanged && (
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            onClick={() =>
              setDetails({
                firstName: user?.firstName || "",
                lastName: user?.lastName || "",
                email: user?.email || "",
                currentPassword: "",
              })
            }
          >
            Discard changes
          </Button>
        )}
      </FormSection>

      <FormSection
        title="Password"
        description="Change your own password. There is no email reset in this system, so keep it somewhere you can find it."
        actions={
          <Button
            variant="primary"
            icon={KeyRound}
            loading={savingPw}
            disabled={!pw.currentPassword || !pw.newPassword || !pw.confirm}
            onClick={savePassword}
          >
            Change password
          </Button>
        }
      >
        <Field label="Current password">
          <input
            id="current-password"
            type="password"
            aria-label="Current password"
            value={pw.currentPassword}
            onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
            autoComplete="current-password"
            style={inputStyle}
          />
        </Field>

        <div style={{ display: "flex", gap: "var(--s-4)", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 220px", minWidth: 200 }}>
            <Field label="New password" hint="At least 10 characters. A phrase you will remember beats a puzzle you will not.">
              <input
                id="new-password"
                type="password"
                aria-label="New password"
                value={pw.newPassword}
                onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
                autoComplete="new-password"
                style={inputStyle}
              />
            </Field>
          </div>
          <div style={{ flex: "1 1 220px", minWidth: 200 }}>
            <Field
              label="Repeat new password"
              hint={
                pw.confirm && pw.confirm !== pw.newPassword ? "These two do not match." : " "
              }
            >
              <input
                id="confirm-password"
                type="password"
                aria-label="Repeat new password"
                value={pw.confirm}
                onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                autoComplete="new-password"
                style={{
                  ...inputStyle,
                  borderColor:
                    pw.confirm && pw.confirm !== pw.newPassword ? "var(--danger-line)" : undefined,
                }}
              />
            </Field>
          </div>
        </div>

        <p style={{ margin: 0, fontSize: "var(--fs-11)", color: "var(--text-3)", lineHeight: 1.5 }}>
          Changing your password does not sign out devices that are already signed in — those sessions
          run out on their own, within 8 hours. If you think somebody else is using your account, tell an
          administrator so they can deactivate it.
        </p>
      </FormSection>
    </SettingsPage>
  );
}

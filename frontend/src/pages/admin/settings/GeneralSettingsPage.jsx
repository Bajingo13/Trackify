import { useCallback, useEffect, useMemo, useState } from "react";
import { Hash, Clock, Save, Lock, PhoneCall } from "lucide-react";
import { Button, Field, inputStyle } from "../../../components/ui";
import { SettingsPage, FormSection } from "../../../components/settings";
import { useToast } from "../../../components/shared/Toast";
import { useAuth } from "../../../context/AuthContext";
import {
  getCompanySettings,
  updateCompanySettings,
} from "../../../services/admin/settingsService";

/**
 * Company-wide defaults.
 *
 * Only two settings, and both were chosen because something already reads
 * them: the ticket prefix is what `generateTripNumber` puts in front of every
 * new trip number, and the retention period is what the nightly sweep uses to
 * decide which location points to delete. Nothing here is a placeholder for a
 * feature that does not exist yet — a toggle that saves and changes nothing is
 * worse than no toggle, because somebody sets it and believes it took.
 */

const YEAR = new Date().getFullYear();

/** Roughly how long, said the way a person would say it. */
function inPlainWords(months) {
  const n = Number(months);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n === 12) return "one year";
  if (n === 24) return "two years";
  if (n % 12 === 0) return `${n / 12} years`;
  if (n === 1) return "one month";
  if (n < 12) return `${n} months`;
  return `${Math.floor(n / 12)} year${n >= 24 ? "s" : ""} and ${n % 12} month${n % 12 === 1 ? "" : "s"}`;
}

export default function GeneralSettingsPage() {
  const { addToast } = useToast();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("company.manage");

  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState({ tripPrefix: "", locationRetentionMonths: "", emergencyLine: "", requirePreTripInspection: false, requireOdometer: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCompanySettings()
      .then((data) => {
        if (cancelled) return;
        setSaved(data);
        setForm({
          tripPrefix: data.tripPrefix,
          locationRetentionMonths: String(data.locationRetentionMonths),
          emergencyLine: data.emergencyLine || "",
          requirePreTripInspection: Boolean(data.requirePreTripInspection),
          requireOdometer: Boolean(data.requireOdometer),
        });
      })
      .catch((error) => {
        if (!cancelled) addToast(error.message || "Could not load settings.", "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [addToast]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  /* The same rule the server enforces, so the page says no before the round
   * trip rather than after it. The server still checks — this is a courtesy,
   * not the guard. */
  const prefixError = useMemo(() => {
    const value = form.tripPrefix.trim().toUpperCase();
    if (!value) return "A prefix is required.";
    if (!/^[A-Z][A-Z0-9-]{0,9}$/.test(value)) {
      return "Start with a letter; letters, numbers and dashes only; 10 characters at most.";
    }
    return null;
  }, [form.tripPrefix]);

  const months = Number(form.locationRetentionMonths);
  const retentionError = useMemo(() => {
    if (!Number.isInteger(months) || months < 1 || months > 120) {
      return "A whole number of months, between 1 and 120.";
    }
    return null;
  }, [months]);

  // Same rule as the server (normaliseEmergencyLine): empty clears it.
  const line = form.emergencyLine.trim().replace(/\s+/g, " ");
  const lineError = useMemo(() => {
    if (!line) return null;
    const digits = line.replace(/\D/g, "").length;
    if (line.length > 20 || !/^\+?[0-9 ()-]+$/.test(line) || digits < 3 || digits > 15) {
      return "Digits, spaces, dashes or brackets, with an optional + at the start; 3 to 15 digits.";
    }
    return null;
  }, [line]);
  const lineChanged = saved && line !== (saved.emergencyLine || "");
  const inspectionChanged = saved && form.requirePreTripInspection !== Boolean(saved.requirePreTripInspection);
  const odometerChanged = saved && form.requireOdometer !== Boolean(saved.requireOdometer);

  const dirty =
    saved &&
    (form.tripPrefix.trim().toUpperCase() !== saved.tripPrefix ||
      months !== saved.locationRetentionMonths ||
      lineChanged ||
      inspectionChanged ||
      odometerChanged);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      // The line and the inspection rule are sent only when they changed, so
      // saving the other two never depends on them.
      const data = await updateCompanySettings({
        tripPrefix: form.tripPrefix.trim().toUpperCase(),
        locationRetentionMonths: months,
        ...(lineChanged ? { emergencyLine: line } : {}),
        ...(inspectionChanged ? { requirePreTripInspection: form.requirePreTripInspection } : {}),
        ...(odometerChanged ? { requireOdometer: form.requireOdometer } : {}),
      });
      setSaved((before) => ({ ...before, ...data }));
      setForm({
        tripPrefix: data.tripPrefix,
        locationRetentionMonths: String(data.locationRetentionMonths),
        emergencyLine: data.emergencyLine ?? (lineChanged ? line : form.emergencyLine),
        requirePreTripInspection: data.requirePreTripInspection ?? form.requirePreTripInspection,
        requireOdometer: data.requireOdometer ?? form.requireOdometer,
      });
      addToast("Settings saved.", "success");
    } catch (error) {
      addToast(error.message || "Could not save settings.", "error");
    } finally {
      setSaving(false);
    }
  }, [form.tripPrefix, form.emergencyLine, form.requirePreTripInspection, form.requireOdometer, months, line, lineChanged, inspectionChanged, odometerChanged, addToast]);

  const previewPrefix = prefixError ? saved?.tripPrefix || "TT" : form.tripPrefix.trim().toUpperCase();

  return (
    <SettingsPage
      eyebrow="System"
      title="General Settings"
      description="Company-wide defaults — trip-ticket numbering, how long the location trail is kept, and the drivers' emergency line."
      actions={
        canEdit ? (
          <Button
            variant="primary"
            icon={Save}
            loading={saving}
            disabled={loading || !dirty || !!prefixError || !!retentionError || !!lineError}
            onClick={save}
          >
            Save changes
          </Button>
        ) : null
      }
    >
      {!canEdit && (
        <p
          style={{
            display: "flex", alignItems: "center", gap: 8, margin: "0 0 var(--s-4)",
            fontSize: "var(--fs-12)", color: "var(--text-3)",
          }}
        >
          <Lock size={13} />
          You can see these settings but not change them. Ask an administrator.
        </p>
      )}

      <FormSection
        title="Trip ticket numbering"
        description="The letters in front of every new trip ticket number. Existing tickets keep the number they were issued."
      >
        <Field
          label="Prefix"
          hint={prefixError && !loading ? prefixError : "For example ABC, DVO, or TT."}
        >
          <input
            id="trip-prefix"
            value={form.tripPrefix}
            onChange={set("tripPrefix")}
            disabled={!canEdit || loading}
            maxLength={10}
            spellCheck={false}
            autoComplete="off"
            style={{
              ...inputStyle,
              maxWidth: 220,
              textTransform: "uppercase",
              borderColor: prefixError && !loading ? "var(--danger-line)" : undefined,
            }}
          />
        </Field>

        {/* The format, shown rather than described. */}
        <div
          style={{
            display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
            background: "var(--surface-sunk)", border: "1px solid var(--line)",
            borderRadius: "var(--r-sm)",
          }}
        >
          <Hash size={14} style={{ color: "var(--text-3)", flexShrink: 0 }} />
          <span style={{ fontSize: "var(--fs-12)", color: "var(--text-3)" }}>Next ticket looks like</span>
          <code
            style={{
              fontSize: "var(--fs-13)", fontWeight: 700, color: "var(--text)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {loading ? "…" : `${previewPrefix}-${YEAR}-000123`}
          </code>
        </div>
      </FormSection>

      <FormSection
        title="Location trail"
        description="How long the minute-by-minute position trail recorded during a trip is kept before it is deleted automatically."
      >
        <Field
          label="Keep for"
          hint={
            retentionError && !loading
              ? retentionError
              : "The trip itself, its stops and its proof of delivery are not affected — only the position trail underneath."
          }
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <input
              id="retention-months"
              type="number"
              min={1}
              max={120}
              value={form.locationRetentionMonths}
              onChange={set("locationRetentionMonths")}
              disabled={!canEdit || loading}
              style={{
                ...inputStyle,
                width: 96,
                fontVariantNumeric: "tabular-nums",
                borderColor: retentionError && !loading ? "var(--danger-line)" : undefined,
              }}
            />
            <span style={{ fontSize: "var(--fs-13)", color: "var(--text-2)" }}>
              months{!retentionError && !loading ? ` — ${inPlainWords(months)}` : ""}
            </span>
          </span>
        </Field>

        <div
          style={{
            display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
            background: "var(--surface-sunk)", border: "1px solid var(--line)",
            borderRadius: "var(--r-sm)",
          }}
        >
          <Clock size={14} style={{ color: "var(--text-3)", flexShrink: 0, marginTop: 2 }} />
          <span style={{ fontSize: "var(--fs-12)", color: "var(--text-3)", lineHeight: 1.5 }}>
            The Data Privacy Policy tells drivers this period. Shortening it deletes trail older than the new
            figure on the next daily sweep, and that cannot be undone. Changes are recorded in the audit log.
          </span>
        </div>
      </FormSection>

      <FormSection
        title="Emergency line"
        description="Who drivers call in an emergency. The Driver App shows it on the Emergency screen with a Call button, and keeps it on the phone for when there is no signal."
      >
        <Field
          label="Emergency number"
          hint={lineError && !loading ? lineError : "For example +63 82 224 1234. Leave it empty to remove it."}
        >
          <input
            id="emergency-line"
            type="tel"
            inputMode="tel"
            value={form.emergencyLine}
            onChange={set("emergencyLine")}
            disabled={!canEdit || loading}
            maxLength={20}
            autoComplete="off"
            placeholder={saved?.emergencyLineDemo || ""}
            style={{
              ...inputStyle,
              maxWidth: 260,
              fontVariantNumeric: "tabular-nums",
              borderColor: lineError && !loading ? "var(--danger-line)" : undefined,
            }}
          />
        </Field>

        {!loading && !saved?.emergencyLine && (
          <div
            role="note"
            style={{
              display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
              background: "var(--warning-soft, var(--surface-sunk))", border: "1px solid var(--line)",
              borderRadius: "var(--r-sm)",
            }}
          >
            <PhoneCall size={14} style={{ color: "var(--text-3)", flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: "var(--fs-12)", color: "var(--text-2)", lineHeight: 1.5 }}>
              {saved?.emergencyLineDemo ? (
                <>
                  <strong>Demo number in use: {saved.emergencyLineDemo}.</strong> It is not a real hotline. Drivers
                  see it labelled as a demo until your company&rsquo;s number is saved here. Production never shows it.
                </>
              ) : (
                <>No emergency line is set. Drivers are offered 911 until your company&rsquo;s number is saved here.</>
              )}
            </span>
          </div>
        )}
      </FormSection>

      <FormSection
        title="Pre-trip inspection"
        description="Before a trip starts, the driver checks brakes, tyres, lights, and fluids and leaks in the Driver App. A problem with brakes, tyres or lights holds the trip until the Fleet team approves departure in Fleet → Inspections."
      >
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: canEdit && !loading ? "pointer" : "default" }}>
          <input
            id="require-inspection"
            type="checkbox"
            checked={form.requirePreTripInspection}
            disabled={!canEdit || loading}
            onChange={(e) => setForm((f) => ({ ...f, requirePreTripInspection: e.target.checked }))}
            style={{ marginTop: 3 }}
          />
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text)" }}>Require a pre-trip inspection before every trip</span>
            <span style={{ fontSize: "var(--fs-12)", color: "var(--text-3)", lineHeight: 1.5 }}>
              Applies to the driver&rsquo;s Start and to starting a trip from the office.
            </span>
          </span>
        </label>

        {inspectionChanged && form.requirePreTripInspection && (
          <div
            role="note"
            style={{
              display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
              background: "var(--warning-soft, var(--surface-sunk))", border: "1px solid var(--line)",
              borderRadius: "var(--r-sm)", fontSize: "var(--fs-12)", color: "var(--text-2)", lineHeight: 1.5,
            }}
          >
            <Lock size={14} style={{ color: "var(--text-3)", flexShrink: 0, marginTop: 2 }} />
            <span>
              <strong>Turn this on once every driver has the updated Driver App.</strong> A phone on an older version
              has no inspection screen, so its driver could not start any trip. Changes are recorded in the audit log.
            </span>
          </div>
        )}
      </FormSection>

      <FormSection
        title="Odometer readings"
        description="The driver enters the odometer before Start and again before confirming delivery, with a photo of the dashboard if they choose. The distance driven shows on the trip, and the Fleet team can correct a wrong reading with a reason."
      >
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: canEdit && !loading ? "pointer" : "default" }}>
          <input
            id="require-odometer"
            type="checkbox"
            checked={form.requireOdometer}
            disabled={!canEdit || loading}
            onChange={(e) => setForm((f) => ({ ...f, requireOdometer: e.target.checked }))}
            style={{ marginTop: 3 }}
          />
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text)" }}>Require odometer readings at Start and at delivery</span>
            <span style={{ fontSize: "var(--fs-12)", color: "var(--text-3)", lineHeight: 1.5 }}>
              Applies to the driver&rsquo;s own Start and delivery. Starting or closing a trip from the office is not held.
            </span>
          </span>
        </label>

        {odometerChanged && form.requireOdometer && (
          <div
            role="note"
            style={{
              display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
              background: "var(--warning-soft, var(--surface-sunk))", border: "1px solid var(--line)",
              borderRadius: "var(--r-sm)", fontSize: "var(--fs-12)", color: "var(--text-2)", lineHeight: 1.5,
            }}
          >
            <Lock size={14} style={{ color: "var(--text-3)", flexShrink: 0, marginTop: 2 }} />
            <span>
              <strong>Turn this on once every driver has the updated Driver App.</strong> A phone on an older version
              cannot enter a reading, so its driver could not start or deliver. Changes are recorded in the audit log.
            </span>
          </div>
        )}
      </FormSection>
    </SettingsPage>
  );
}

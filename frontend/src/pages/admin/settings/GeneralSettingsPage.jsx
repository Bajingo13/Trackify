import { useCallback, useEffect, useMemo, useState } from "react";
import { Hash, Clock, Save, Lock } from "lucide-react";
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
  const [form, setForm] = useState({ tripPrefix: "", locationRetentionMonths: "" });
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

  const dirty =
    saved &&
    (form.tripPrefix.trim().toUpperCase() !== saved.tripPrefix ||
      months !== saved.locationRetentionMonths);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const data = await updateCompanySettings({
        tripPrefix: form.tripPrefix.trim().toUpperCase(),
        locationRetentionMonths: months,
      });
      setSaved(data);
      setForm({
        tripPrefix: data.tripPrefix,
        locationRetentionMonths: String(data.locationRetentionMonths),
      });
      addToast("Settings saved.", "success");
    } catch (error) {
      addToast(error.message || "Could not save settings.", "error");
    } finally {
      setSaving(false);
    }
  }, [form.tripPrefix, months, addToast]);

  const previewPrefix = prefixError ? saved?.tripPrefix || "TT" : form.tripPrefix.trim().toUpperCase();

  return (
    <SettingsPage
      eyebrow="System"
      title="General Settings"
      description="Company-wide defaults — trip-ticket numbering and how long the location trail is kept."
      actions={
        canEdit ? (
          <Button
            variant="primary"
            icon={Save}
            loading={saving}
            disabled={loading || !dirty || !!prefixError || !!retentionError}
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
    </SettingsPage>
  );
}

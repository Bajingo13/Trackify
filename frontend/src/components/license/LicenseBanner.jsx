import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { getMyLicense } from "../../services/admin/licenseService";
import { describeExpiry } from "./licenseDisplay";

/**
 * Warns before a license lapses, and says so once it has — so nobody learns
 * about it from a blocked screen. Silent when the license is healthy, and
 * silent when it cannot be read (a role without company.read, an offline
 * moment): a missing banner is better than a false alarm.
 *
 * AppShell remounts on navigation, so the answer is kept for a few minutes
 * per company instead of being fetched on every page.
 */
const TTL_MS = 5 * 60 * 1000;
let cache = { key: null, at: 0, data: null };

export function __resetLicenseBannerCache() {
  cache = { key: null, at: 0, data: null };
}

function companyKey() {
  try { return localStorage.getItem("ttms_company_id") || ""; } catch { return ""; }
}

const fresh = (key) => cache.key === key && Date.now() - cache.at < TTL_MS;

export default function LicenseBanner() {
  const [license, setLicense] = useState(() => (fresh(companyKey()) ? cache.data : null));

  useEffect(() => {
    const key = companyKey();
    if (!key || fresh(key)) return undefined;
    let cancelled = false;
    getMyLicense()
      .then((data) => {
        cache = { key, at: Date.now(), data };
        if (!cancelled) setLicense(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!license || license.state === "active") return null;

  const lapsed = license.state !== "expiring";
  const color = lapsed ? "var(--danger)" : "var(--warn)";
  return (
    <div
      role={lapsed ? "alert" : "status"}
      style={{
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px var(--s-5)",
        background: lapsed ? "var(--danger-soft)" : "var(--warn-soft)",
        borderBottom: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
        color: "var(--text)", fontSize: "var(--fs-13)",
      }}
    >
      <AlertTriangle size={18} aria-hidden="true" style={{ color, flexShrink: 0 }} />
      <span style={{ flex: "1 1 260px", minWidth: 0, lineHeight: 1.45 }}>
        {license.state === "expiring"
          ? <><strong>Your license expires soon.</strong> {describeExpiry(license)}. Contact your administrator to renew it.</>
          : <strong>{license.message}</strong>}
      </span>
      <Link
        to="/admin/settings/license"
        style={{
          flexShrink: 0, padding: "5px 12px", borderRadius: "var(--r-sm)", fontSize: "var(--fs-12)", fontWeight: 600,
          color, textDecoration: "none", background: "var(--surface)", border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
        }}
      >
        View license
      </Link>
    </div>
  );
}

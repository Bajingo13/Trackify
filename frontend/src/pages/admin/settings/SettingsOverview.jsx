import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ChevronRight, UserCircle, Building2, Users, Settings2, SearchX } from "lucide-react";
import { usePermissions } from "../../../auth/permissions";
import useActiveAccess from "../../../hooks/useActiveAccess";
import { StatCard } from "../../../components/ui";
import { SearchInput } from "../../../components/settings";
import { fadeUp, stagger, staggerItem } from "../../../motion";
import { filterSettingsNav } from "./settingsNav";

/** One-line "what's this for" per section, keyed by route. */
const BLURBS = {
  "/admin/settings/profile": "Your name, email, roles, and where you have access.",
  "/admin/settings/preferences": "Theme and navigation layout for this device.",
  "/admin/settings/notifications": "Which alerts reach you, and how.",
  "/admin/settings/companies": "Companies operating on Trackify.",
  "/admin/settings/branches": "Operating branches and trip-ticket prefixes.",
  "/admin/settings/users": "People with access, and the roles they hold.",
  "/admin/settings/roles": "What each role can do within the company.",
  "/admin/settings/integrations": "Connect Trackify to email, maps, webhooks, and storage.",
  "/admin/settings/general": "Company-wide defaults and configuration.",
  "/admin/settings/audit-logs": "A record of every change made through Trackify.",
};

/** Group icon + how many sections the group has in total (before permission filtering). */
const GROUP_META = {
  Account: { icon: UserCircle, total: 3 },
  Organization: { icon: Building2, total: 2 },
  "User Management": { icon: Users, total: 2 },
  System: { icon: Settings2, total: 3 },
};

export default function SettingsOverview() {
  const { can } = usePermissions();
  const { current: company } = useActiveAccess();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => filterSettingsNav(can), [can]);

  const sections = useMemo(
    () =>
      groups.flatMap((g) =>
        g.items.map((it) => ({ ...it, group: g.label, blurb: BLURBS[it.path] || "" }))
      ),
    [groups]
  );

  const q = query.trim().toLowerCase();
  const filtered = q
    ? sections.filter(
        (s) =>
          s.label.toLowerCase().includes(q) ||
          s.blurb.toLowerCase().includes(q) ||
          s.group.toLowerCase().includes(q)
      )
    : sections;

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show">
      {/* ---- header ---- */}
      <div
        style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          gap: "var(--s-4)", flexWrap: "wrap", marginBottom: "var(--s-5)",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-pixel)", fontSize: 10, letterSpacing: "1.6px",
              textTransform: "uppercase", color: "var(--text-3)", marginBottom: 7,
            }}
          >
            Settings
          </div>
          <h2 style={{ margin: 0, fontSize: "var(--fs-18)", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text)" }}>
            Settings overview
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: "var(--fs-13)", color: "var(--text-2)" }}>
            Everything you can configure, in one place.
          </p>
        </div>

        <div style={{ flex: "0 1 320px", minWidth: 200 }}>
          <SearchInput value={query} onChange={setQuery} placeholder="Search settings…" width="100%" />
          {company && (
            <div
              className="tk-mono"
              title={`${company.company_name}${company.branch_name ? ` · ${company.branch_name}` : ""}`}
              style={{
                marginTop: 6, fontSize: "var(--fs-11)", color: "var(--text-3)",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}
            >
              {company.company_name}{company.branch_name ? ` · ${company.branch_name}` : ""}
            </div>
          )}
        </div>
      </div>

      {/* ---- group stats ---- */}
      <div
        style={{
          display: "grid", gap: "var(--s-3)", marginBottom: "var(--s-6)",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        }}
      >
        {groups.map((g, i) => {
          const meta = GROUP_META[g.label] || {};
          const total = meta.total ?? g.items.length;
          const visible = g.items.length;
          return (
            <StatCard
              key={g.label}
              index={i}
              icon={meta.icon}
              label={g.label}
              value={visible}
              hint={visible >= total ? "All available" : `of ${total} available`}
              onClick={() => navigate(g.items[0].path)}
            />
          );
        })}
      </div>

      {/* ---- sections ---- */}
      <h3 style={{ margin: "0 0 var(--s-3)", fontSize: "var(--fs-14)", fontWeight: 700, color: "var(--text)" }}>
        Settings sections
      </h3>

      {filtered.length === 0 ? (
        <div
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
            padding: "var(--s-10) var(--s-4)", textAlign: "center",
            border: "1px dashed var(--line-strong)", borderRadius: "var(--r-lg)", background: "var(--surface-2)",
          }}
        >
          <span style={{ width: 40, height: 40, borderRadius: "var(--r-md)", background: "var(--surface-sunk)", color: "var(--text-3)", display: "grid", placeItems: "center" }}>
            <SearchX size={18} />
          </span>
          <div style={{ fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--text)" }}>
            No settings match “{query}”
          </div>
          <button
            onClick={() => setQuery("")}
            style={{ border: "none", background: "transparent", color: "var(--accent)", cursor: "pointer", fontSize: "var(--fs-12)", fontWeight: 600 }}
          >
            Clear search
          </button>
        </div>
      ) : (
        <motion.div
          variants={stagger()}
          initial="hidden"
          animate="show"
          style={{
            display: "grid", gap: "var(--s-4)",
            gridTemplateColumns: "repeat(auto-fill, minmax(258px, 1fr))",
          }}
        >
          {filtered.map((s) => {
            const Icon = s.icon;
            return (
              <motion.button
                key={s.path}
                variants={staggerItem}
                onClick={() => navigate(s.path)}
                whileHover={{ y: -2, boxShadow: "var(--shadow-2)" }}
                transition={{ duration: 0.16 }}
                style={{
                  display: "flex", flexDirection: "column", gap: 10, width: "100%",
                  padding: "var(--s-4)", textAlign: "left", cursor: "pointer",
                  border: "1px solid var(--line)", borderRadius: "var(--r-md)",
                  background: "var(--surface)", boxShadow: "var(--shadow-1)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <span
                    style={{
                      width: 36, height: 36, borderRadius: "var(--r-sm)", flexShrink: 0,
                      background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center",
                    }}
                  >
                    <Icon size={17} />
                  </span>
                  <span
                    style={{
                      fontSize: "var(--fs-11)", fontWeight: 600, color: "var(--text-3)",
                      background: "var(--surface-sunk)", border: "1px solid var(--line)",
                      borderRadius: "var(--r-pill)", padding: "2px 9px", whiteSpace: "nowrap",
                    }}
                  >
                    {s.group}
                  </span>
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "var(--fs-13)", fontWeight: 700, color: "var(--text)" }}>{s.label}</div>
                  <p
                    style={{
                      margin: "3px 0 0", fontSize: "var(--fs-12)", color: "var(--text-2)", lineHeight: 1.5,
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                    }}
                  >
                    {s.blurb}
                  </p>
                </div>

                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: "var(--fs-12)", fontWeight: 600, color: "var(--accent)" }}>
                  Open <ChevronRight size={14} />
                </span>
              </motion.button>
            );
          })}
        </motion.div>
      )}
    </motion.div>
  );
}

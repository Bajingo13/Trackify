import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, LayoutDashboard, ScrollText } from "lucide-react";
import navigation, { filterNavigation } from "../../data/navigationConfig";
import { usePermissions } from "../../auth/permissions";

/** Horizontal navigation for the top-bar layout mode. */
export default function TopNavBar() {
  const { can } = usePermissions();
  const { pathname } = useLocation();
  const items = useMemo(() => filterNavigation(navigation, can), [can]);
  const [open, setOpen] = useState(null);
  const [anchor, setAnchor] = useState(null);
  const navRef = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (!navRef.current) return;
      if (!navRef.current.contains(e.target) && !e.target.closest?.("[data-topnav-menu]")) {
        setOpen(null);
      }
    };
    document.addEventListener("mousedown", close);
    const closeOnResize = () => setOpen(null);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", closeOnResize);
    };
  }, []);
  useEffect(() => setOpen(null), [pathname]);

  const linkStyle = (active) => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 11px",
    borderRadius: "var(--r-sm)", textDecoration: "none", whiteSpace: "nowrap",
    fontFamily: "var(--font-pixel)", fontSize: "12.5px", fontWeight: 400, letterSpacing: "0.4px",
    border: "none", cursor: "pointer",
    color: active ? "var(--accent-ink)" : "var(--text-2)",
    background: active ? "var(--accent-soft)" : "transparent",
  });

  function toggleGroup(label, el) {
    if (open === label) { setOpen(null); return; }
    const r = el.getBoundingClientRect();
    setAnchor({ left: Math.min(r.left, window.innerWidth - 232), top: r.bottom + 6 });
    setOpen(label);
  }

  const openGroup = items.find((g) => g.label === open);

  return (
    <>
      <nav
        ref={navRef}
        style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0, overflowX: "auto", overflowY: "visible", scrollbarWidth: "none" }}
      >
        <NavLink to="/dashboard" style={({ isActive }) => linkStyle(isActive)}>
          <LayoutDashboard size={15} /> Dashboard
        </NavLink>

        {items.map((group) => {
          if (!group.children) {
            const active = pathname.startsWith(group.path);
            return (
              <NavLink key={group.label} to={group.path} style={linkStyle(active)}>
                <ScrollText size={15} /> {group.label}
              </NavLink>
            );
          }
          const groupActive = group.children.some((c) => pathname.startsWith(c.path));
          const isOpen = open === group.label;
          return (
            <button
              key={group.label}
              onClick={(e) => toggleGroup(group.label, e.currentTarget)}
              style={{ ...linkStyle(groupActive), background: groupActive || isOpen ? "var(--accent-soft)" : "transparent" }}
            >
              {group.label}
              <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.18 }} style={{ display: "inline-flex" }}>
                <ChevronDown size={13} />
              </motion.span>
            </button>
          );
        })}
      </nav>

      {createPortal(
        <AnimatePresence>
          {openGroup && anchor && (
            <motion.div
              data-topnav-menu
              className="tk-scope"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
              style={{
                position: "fixed", left: anchor.left, top: anchor.top, minWidth: 210,
                background: "var(--surface)", border: "1px solid var(--line)",
                borderRadius: "var(--r-md)", boxShadow: "var(--shadow-3)", padding: 6, zIndex: 200,
              }}
            >
              {openGroup.children.map((child) => {
                const active = pathname === child.path || pathname.startsWith(child.path + "/");
                return (
                  <NavLink
                    key={child.path}
                    to={child.path}
                    onClick={() => setOpen(null)}
                    style={{
                      display: "block", padding: "8px 10px", borderRadius: "var(--r-sm)",
                      textDecoration: "none", fontSize: "var(--fs-13)",
                      fontWeight: active ? 600 : 500,
                      color: active ? "var(--accent)" : "var(--text-2)",
                      background: active ? "var(--accent-soft)" : "transparent",
                    }}
                  >
                    {child.label}
                  </NavLink>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}

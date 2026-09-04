import { useState } from "react";
import { motion } from "motion/react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

/**
 * The application frame: sidebar + topbar + an animated content area.
 * Pages opt in — `<AppShell><MyPage/></AppShell>`.
 *
 * Navigation can live in a left sidebar (default, collapsible) or across the
 * top bar — the user's choice, persisted to localStorage.
 * `pageKey` (usually the route path) drives the content transition.
 */
export default function AppShell({ children, pageKey }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("tk_sidebar") === "collapsed"; } catch { return false; }
  });
  const [navMode, setNavMode] = useState(() => {
    try { return localStorage.getItem("tk_nav_mode") === "top" ? "top" : "side"; } catch { return "side"; }
  });

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem("tk_sidebar", next ? "collapsed" : "open"); } catch {}
      return next;
    });
  };

  const toggleNavMode = () => {
    setNavMode((m) => {
      const next = m === "side" ? "top" : "side";
      try { localStorage.setItem("tk_nav_mode", next); } catch {}
      return next;
    });
  };

  return (
    <div className="tk-scope" style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}>
      <div className="tk-shell-bg" aria-hidden="true" />

      {navMode === "side" && <Sidebar collapsed={collapsed} />}

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Topbar
          navMode={navMode}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onToggleNavMode={toggleNavMode}
        />
        <motion.main
          key={pageKey}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          style={{
            flex: 1,
            padding: "var(--s-6) var(--s-6)",
            maxWidth: navMode === "top" ? "1600px" : "var(--content-max)",
            width: "100%",
            margin: "0 auto",
          }}
        >
          {children}
        </motion.main>
      </div>
    </div>
  );
}

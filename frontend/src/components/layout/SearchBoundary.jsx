import { Component } from "react";

/**
 * Catches the palette failing to load or render.
 *
 * The palette is a lazy chunk. After a deploy, a tab opened the day before asks
 * for a hashed file that no longer exists, the import rejects, and without a
 * boundary that rejection unmounts the whole application frame — a blank
 * screen because somebody pressed Ctrl+K. A cached rejected import also never
 * recovers on its own, so the honest remedy is a reload.
 */
export default class SearchBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error) {
    // eslint-disable-next-line no-console
    console.error("Search could not be shown", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { onClose } = this.props;
    return (
      <div
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
        onKeyDown={(e) => { if (e.key === "Escape") onClose?.(); }}
        style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "12vh", background: "rgba(7,26,74,0.28)" }}
      >
        <div
          role="alertdialog" aria-modal="true" aria-label="Search unavailable"
          style={{ width: "min(420px, calc(100vw - 32px))", padding: 18, background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: "var(--r-md)", color: "var(--text)", fontSize: "var(--fs-13)" }}
        >
          <p style={{ margin: "0 0 12px" }}>
            <strong>Search couldn't load.</strong> Trackify may have been updated since this page was opened.
            Reload to get the latest version.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="ops-btn ops-btn-secondary" onClick={onClose}>Close</button>
            <button type="button" className="ops-btn ops-btn-primary" autoFocus onClick={() => window.location.reload()}>Reload page</button>
          </div>
        </div>
      </div>
    );
  }
}

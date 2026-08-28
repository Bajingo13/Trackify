import { Construction } from "lucide-react";
import TopNav from "../components/dashboard/TopNav";
import "../styles/operations.css";

export default function ComingSoonPage({ title }) {
  return (
    <div className="ops-page">
      <TopNav />
      <div className="ops-container">
        <div className="ops-header">
          <div className="ops-header-left">
            <h1 className="ops-title">{title}</h1>
            <p className="ops-subtitle">This module is under development</p>
          </div>
        </div>
        <div className="ops-card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 20px" }}>
          <div style={{
            width: 72, height: 72, borderRadius: 18, background: "#EEF4FF",
            display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16,
          }}>
            <Construction size={36} style={{ color: "#2455D6", opacity: 0.7 }} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--trackify-text)", margin: "0 0 8px" }}>
            Coming Soon
          </h2>
          <p style={{ fontSize: 14, color: "var(--trackify-text-secondary)", textAlign: "center", maxWidth: 360, margin: 0, lineHeight: 1.6 }}>
            The <strong>{title}</strong> module is currently under development. Check back soon for updates.
          </p>
        </div>
      </div>
    </div>
  );
}

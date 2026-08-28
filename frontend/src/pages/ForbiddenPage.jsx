import { useNavigate } from "react-router-dom";
import { ShieldOff } from "lucide-react";
import TopNav from "../components/dashboard/TopNav";
import "../styles/operations.css";

export default function ForbiddenPage() {
  const navigate = useNavigate();
  return (
    <div className="ops-page">
      <TopNav />
      <div className="ops-container">
        <div
          className="ops-card"
          style={{ maxWidth: 460, margin: "48px auto", padding: 32, textAlign: "center" }}
        >
          <div
            style={{
              width: 52, height: 52, borderRadius: 14, margin: "0 auto 16px",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "#FEF2F2", color: "#DC2626",
            }}
          >
            <ShieldOff size={26} />
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--trackify-text)", margin: "0 0 6px" }}>
            You don't have access to this page
          </h1>
          <p style={{ fontSize: 13, color: "var(--trackify-text-secondary)", margin: "0 0 20px" }}>
            Your role doesn't include the permission this screen needs. Ask a company
            administrator if you think this is a mistake.
          </p>
          <button className="ops-btn ops-btn-primary" onClick={() => navigate("/dashboard")}>
            Back to dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

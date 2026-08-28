import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronDown, Plus, Building2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { datePresets } from "../../data/dashboardData";

export default function DashboardHeader({ dateLabel, onDateChange }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(dateLabel);
  const [ctxOpen, setCtxOpen] = useState(false);
  const ref = useRef(null);
  const ctxRef = useRef(null);

  const firstName = user?.firstName || "User";
  const companyName = user?.access?.[0]?.company_name || "AstreaBlue Logistics";
  const branchName = user?.access?.[0]?.branch_name || "All Branches";

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    function handler(e) {
      if (ctxRef.current && !ctxRef.current.contains(e.target)) setCtxOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold leading-tight" style={{ color: "var(--trackify-text)" }}>
          Welcome back, {firstName} 👋
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--trackify-text-secondary)" }}>
          Here&apos;s what&apos;s happening across your trips and operations today.
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {/* Operating Context Selector */}
        <div className="relative" ref={ctxRef}>
          <button
            onClick={() => setCtxOpen(!ctxOpen)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-blue-400"
            style={{
              background: "var(--trackify-surface)",
              border: "1px solid var(--trackify-border)",
              color: "var(--trackify-text)",
              boxShadow: "0 1px 4px rgba(7,26,74,0.06)",
            }}
          >
            <Building2 size={14} style={{ color: "var(--trackify-blue)" }} />
            <span className="hidden sm:inline">{companyName} · {branchName}</span>
            <span className="sm:hidden">{branchName}</span>
            <ChevronDown size={13} style={{ color: "var(--trackify-text-secondary)", transform: ctxOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
          </button>
          {ctxOpen && (
            <div
              className="absolute right-0 mt-1 py-1 w-60 rounded-xl z-50"
              style={{
                background: "var(--trackify-surface)",
                border: "1px solid var(--trackify-border)",
                boxShadow: "0 8px 32px rgba(7,26,74,0.12)",
              }}
            >
              <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--trackify-text-secondary)" }}>
                Operating Context
              </div>
              <button
                className="w-full text-left px-4 py-2 text-sm transition-colors"
                style={{ color: "var(--trackify-blue)", background: "var(--trackify-surface-blue)" }}
              >
                {companyName}
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm transition-colors"
                style={{ color: "var(--trackify-text)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--trackify-surface-blue)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                {branchName}
              </button>
            </div>
          )}
        </div>

        {/* Date Range Picker */}
        <div className="relative" ref={ref}>
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-blue-400"
            style={{
              background: "var(--trackify-surface)",
              border: "1px solid var(--trackify-border)",
              color: "var(--trackify-text)",
              boxShadow: "0 1px 4px rgba(7,26,74,0.06)",
            }}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <Calendar size={14} style={{ color: "var(--trackify-blue)" }} />
            <span>{selected}</span>
            <ChevronDown size={13} style={{ color: "var(--trackify-text-secondary)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
          </button>

          {open && (
            <div
              className="absolute right-0 mt-1 py-1 w-52 rounded-xl z-50"
              style={{
                background: "var(--trackify-surface)",
                border: "1px solid var(--trackify-border)",
                boxShadow: "0 8px 32px rgba(7,26,74,0.12)",
              }}
              role="listbox"
            >
              {datePresets.map((preset) => (
                <button
                  key={preset}
                  role="option"
                  aria-selected={selected === preset}
                  className="w-full text-left px-4 py-2 text-sm transition-colors"
                  style={{ color: selected === preset ? "var(--trackify-blue)" : "var(--trackify-text)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--trackify-surface-blue)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  onClick={() => {
                    setSelected(preset);
                    setOpen(false);
                    onDateChange?.(preset);
                  }}
                >
                  {preset}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Create Trip */}
        <button
          className="gradient-btn flex items-center gap-2 px-5 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-white"
          aria-label="Create new trip"
          onClick={() => navigate("/operations/trips")}
        >
          <Plus size={15} strokeWidth={2.5} />
          Create Trip
        </button>
      </div>
    </div>
  );
}

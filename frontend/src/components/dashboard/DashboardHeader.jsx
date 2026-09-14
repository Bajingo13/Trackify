import { useState, useRef, useEffect, useMemo } from "react";
import { Calendar, ChevronDown, ChevronRight, ChevronLeft, Plus, Building2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Can } from "../../auth/permissions";
import { datePresets } from "../../data/dashboardData";
import useActiveAccess from "../../hooks/useActiveAccess";

export default function DashboardHeader({ dateLabel, onDateChange }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(dateLabel);
  const [ctxOpen, setCtxOpen] = useState(false);
  const ref = useRef(null);
  const ctxRef = useRef(null);

  const firstName = user?.firstName || "User";
  const { accessList, activeCompanyId, activeBranchId, current } = useActiveAccess();

  // Group into companies so the picker can ask "which company?" first and
  // only reveal that company's branches — a flat list gets unwieldy once
  // there's more than one company, each with several branches.
  const companies = useMemo(() => {
    const byId = new Map();
    for (const a of accessList) {
      if (!byId.has(a.company_id)) byId.set(a.company_id, { company_id: a.company_id, company_name: a.company_name, branches: [] });
      byId.get(a.company_id).branches.push(a);
    }
    return [...byId.values()];
  }, [accessList]);
  const multiCompany = companies.length > 1;
  const [pickedCompanyId, setPickedCompanyId] = useState(null);

  const companyName = current?.company_name || "AstreaBlue Logistics";
  const branchName = current?.branch_name || "All Branches";

  // Company/branch scope every API call — a full reload is the reliable way to
  // get every open page to refetch under the new context.
  const switchContext = (a) => {
    try {
      localStorage.setItem("ttms_company_id", a.company_id);
      if (a.branch_id) localStorage.setItem("ttms_branch_id", a.branch_id);
      else localStorage.removeItem("ttms_branch_id");
    } catch { /* storage unavailable */ }
    window.location.reload();
  };

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

  // start back at "pick a company" each time the dropdown is reopened
  useEffect(() => { if (!ctxOpen) setPickedCompanyId(null); }, [ctxOpen]);

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-[40]">
      {/* Greeting */}
      <div>
        <span className="tk-eyebrow" style={{ marginBottom: 6 }}>Operations Control</span>
        <h1 className="text-2xl sm:text-3xl font-bold leading-tight" style={{ color: "var(--trackify-text)" }}>
          Welcome, {firstName}
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--trackify-text-secondary)" }}>
          Here&apos;s what&apos;s moving across your trips and operations today.
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
              className="absolute right-0 mt-1 py-1 w-64 rounded-xl z-[70]"
              style={{
                background: "var(--trackify-surface)",
                border: "1px solid var(--trackify-border)",
                boxShadow: "0 8px 32px rgba(7,26,74,0.12)",
              }}
            >
              {multiCompany && pickedCompanyId == null ? (
                <>
                  <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--trackify-text-secondary)" }}>
                    Select a company
                  </div>
                  {companies.map((c) => {
                    const isCurrentCompany = String(c.company_id) === String(activeCompanyId);
                    return (
                      <button
                        key={c.company_id}
                        onClick={() => setPickedCompanyId(c.company_id)}
                        className="w-full flex items-center justify-between gap-2 text-left px-4 py-2 text-sm transition-colors"
                        style={{ color: "var(--trackify-text)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--trackify-surface-blue)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <span>
                          <span className="block font-medium">{c.company_name}</span>
                          <span className="block text-[11px]" style={{ color: "var(--trackify-text-secondary)" }}>
                            {c.branches.length} {c.branches.length === 1 ? "branch" : "branches"}{isCurrentCompany ? " · current" : ""}
                          </span>
                        </span>
                        <ChevronRight size={14} style={{ color: "var(--trackify-text-secondary)", flexShrink: 0 }} />
                      </button>
                    );
                  })}
                </>
              ) : (
                <>
                  <div className="px-2 py-1 flex items-center gap-1">
                    {multiCompany && (
                      <button
                        onClick={() => setPickedCompanyId(null)}
                        aria-label="Back to companies"
                        className="flex items-center justify-center rounded-lg transition-colors"
                        style={{ width: 24, height: 24, color: "var(--trackify-text-secondary)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--trackify-surface-blue)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <ChevronLeft size={14} />
                      </button>
                    )}
                    <span className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--trackify-text-secondary)" }}>
                      {multiCompany ? companies.find((c) => c.company_id === pickedCompanyId)?.company_name : "Operating Context"}
                    </span>
                  </div>
                  {(multiCompany ? companies.find((c) => c.company_id === pickedCompanyId)?.branches ?? [] : accessList).map((a, i) => {
                    const active = String(a.company_id) === String(activeCompanyId)
                      && String(a.branch_id ?? "") === String(activeBranchId ?? "");
                    return (
                      <button
                        key={`${a.company_id}-${a.branch_id ?? "all"}-${i}`}
                        onClick={() => switchContext(a)}
                        disabled={active}
                        className="w-full text-left px-4 py-2 text-sm transition-colors"
                        style={{
                          color: active ? "var(--trackify-blue)" : "var(--trackify-text)",
                          background: active ? "var(--trackify-surface-blue)" : "transparent",
                          cursor: active ? "default" : "pointer",
                        }}
                        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--trackify-surface-blue)"; }}
                        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                      >
                        {!multiCompany && <span className="block font-medium">{a.company_name}</span>}
                        <span className="block text-[11px]" style={{ color: active ? "var(--trackify-blue)" : "var(--trackify-text-secondary)" }}>
                          {a.branch_name || "All branches"}{active ? " · current" : ""}
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
              {accessList.length <= 1 && (
                <div className="px-4 py-2 text-[11px]" style={{ color: "var(--trackify-text-secondary)", borderTop: "1px solid var(--trackify-border)" }}>
                  You only have access to this one company and branch.
                </div>
              )}
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
              className="absolute right-0 mt-1 py-1 w-52 rounded-xl z-[70]"
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
        <Can permission="trip.create">
          <button
            className="gradient-btn flex items-center gap-2 px-5 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-white"
            aria-label="Create new trip"
            onClick={() => navigate("/operations/trips")}
          >
            <Plus size={15} strokeWidth={2.5} />
            Create Trip
          </button>
        </Can>
      </div>
    </div>
  );
}

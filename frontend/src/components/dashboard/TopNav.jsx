import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Bell, AlertTriangle, ChevronDown, User, LogOut, Search,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { usePermissions } from "../../auth/permissions";
import navigation, { filterNavigation } from "../../data/navigationConfig";
import NavigationDropdown from "./NavigationDropdown";
import { operationalAlerts } from "../../data/dashboardData";
import astreablueLogo from "../../assets/astreablue-logo.png";

export default function TopNav() {
  const [notifCount] = useState(3);
  const location = useLocation();
  const [activeRoute, setActiveRoute] = useState(location.pathname);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);
  const navRef = useRef(null);
  const prevScrollY = useRef(0);
  const { user, logout } = useAuth();
  const { can } = usePermissions();
  const visibleNav = filterNavigation(navigation, can);
  const navigate = useNavigate();

  useEffect(() => {
    setActiveRoute(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    const THRESHOLD = 8;
    const MIN_OPACITY = 0.65;
    const MAX_OPACITY = 1;

    prevScrollY.current = window.scrollY;

    const handleScroll = () => {
      const currentY = window.scrollY;
      const diff = currentY - prevScrollY.current;

      if (Math.abs(diff) < THRESHOLD) return;

      if (!navRef.current) return;

      const currentOpacity = parseFloat(navRef.current.style.opacity) || MAX_OPACITY;

      if (currentY > prevScrollY.current) {
        // scrolling DOWN — reduce opacity
        const newOpacity = Math.max(MIN_OPACITY, currentOpacity - 0.05);
        navRef.current.style.opacity = newOpacity;
      } else if (currentY < prevScrollY.current) {
        // scrolling UP — restore opacity
        const newOpacity = Math.min(MAX_OPACITY, currentOpacity + 0.05);
        navRef.current.style.opacity = newOpacity;
      }

      // at top — full opacity
      if (currentY <= 0) {
        navRef.current.style.opacity = MAX_OPACITY;
      }

      prevScrollY.current = currentY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleSelectChild = useCallback((child) => {
    setActiveRoute(child.path);
    navigate(child.path);
  }, [navigate]);

  const handleSelectParent = useCallback((item) => {
    if (item.path) {
      setActiveRoute(item.path);
      navigate(item.path);
    }
  }, [navigate]);

  function isActiveParent(item) {
    if (item.path) return item.path === activeRoute;
    if (item.children) return item.children.some((c) => c.path === activeRoute);
    return false;
  }

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  useEffect(() => {
    function handleClickOutside(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const displayName = user?.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : "Super Admin";
  const displayRole = user?.roles?.[0]?.role_name || "Admin";
  const displayEmail = user?.email || "";
  const companyName = user?.access?.[0]?.company_name || "";
  const branchName = user?.access?.[0]?.branch_name || "";

  return (
    <nav ref={navRef} className="w-full sticky top-0 z-50 px-4 pt-4 pb-2" style={{ opacity: 1, transition: "opacity 200ms ease-in-out" }}>
      <div
        className="max-w-[1400px] mx-auto flex items-center gap-3 px-4 py-2.5 rounded-2xl"
        style={{
          background: "#ffffff",
          border: "1px solid #e5e9f0",
          boxShadow: "0 1px 8px rgba(7,26,74,0.06), 0 4px 20px rgba(7,26,74,0.04)",
        }}
      >
        {/* Logo */}
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center flex-shrink-0 mr-4"
        >
          <img
            src={astreablueLogo}
            alt="AstreaBlue"
            className="h-10 w-auto"
          />
        </button>

        {/* Nav items */}
        <div className="flex items-center gap-1 flex-1 overflow-x-auto nav-scrollbar pl-2">
          {visibleNav.map((item) => {
            if (item.children) {
              return (
                <NavigationDropdown
                  key={item.label}
                  label={item.label}
                  children={item.children}
                  isActive={isActiveParent(item)}
                  activeChild={activeRoute}
                  onSelectChild={handleSelectChild}
                />
              );
            }

            const active = item.path === activeRoute;
            return (
              <button
                key={item.label}
                onClick={() => handleSelectParent(item)}
                className="nav-item flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-blue-400"
                style={{
                  transition: "all 0.2s ease",
                  ...(active
                    ? {
                        background: "#071A4A",
                        color: "#ffffff",
                        border: "1px solid #071A4A",
                      }
                    : {
                        color: "#66728F",
                        border: "1px solid transparent",
                        background: "transparent",
                      }),
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = "#EEF4FF";
                    e.currentTarget.style.color = "#071A4A";
                    e.currentTarget.style.borderColor = "#B5C8F5";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "#66728F";
                    e.currentTarget.style.borderColor = "transparent";
                  }
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Search */}
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm cursor-pointer transition-colors"
            style={{
              background: "#F5F8FE",
              border: "1px solid #e5e9f0",
              color: "#94A3BD",
              minWidth: 160,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#EEF4FF"; e.currentTarget.style.borderColor = "#d0d8e8"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#F5F8FE"; e.currentTarget.style.borderColor = "#e5e9f0"; }}
          >
            <Search size={13} />
            <span className="text-xs">Search...</span>
            <span
              className="ml-auto text-[10px] px-1.5 py-0.5 rounded font-mono"
              style={{ background: "#e5e9f0", color: "#66728F" }}
            >
              Ctrl+K
            </span>
          </div>

          {/* Operational Alerts */}
          <button
            className="relative p-2 rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
            style={{ color: "#66728F" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#F5F8FE"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            aria-label={`Operational Alerts, ${operationalAlerts.length} active`}
          >
            <AlertTriangle size={16} />
            {operationalAlerts.length > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 text-[9px] font-bold rounded-full flex items-center justify-center"
                style={{ background: "#DC2626", color: "#ffffff", width: 15, height: 15 }}
              >
                {operationalAlerts.length}
              </span>
            )}
          </button>

          {/* Notifications */}
          <button
            className="relative p-2 rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
            style={{ color: "#66728F" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#F5F8FE"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            aria-label={`Notifications, ${notifCount} unread`}
          >
            <Bell size={16} />
            {notifCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 text-[9px] font-bold rounded-full flex items-center justify-center"
                style={{ background: "#2455D6", color: "#ffffff", width: 15, height: 15 }}
              >
                {notifCount}
              </span>
            )}
          </button>

          {/* User profile */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => setProfileOpen(!profileOpen)}
              className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-blue-400"
              style={{ border: "1px solid #e5e9f0" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#F5F8FE"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              aria-label="User profile menu"
              aria-haspopup="true"
              aria-expanded={profileOpen}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: "#EEF4FF" }}
              >
                <User size={13} style={{ color: "#2455D6" }} />
              </div>
              <div className="text-left hidden sm:block">
                <div className="text-xs font-semibold leading-tight" style={{ color: "#071A3D" }}>
                  {displayName}
                </div>
                <div className="text-[10px] leading-tight" style={{ color: "#66728F" }}>
                  {displayRole}
                </div>
              </div>
              <ChevronDown
                size={12}
                style={{
                  color: "#94A3BD",
                  transform: profileOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.15s ease",
                }}
              />
            </button>

            {/* Profile Dropdown */}
            {profileOpen && (
              <div
                className="topnav-profile-dropdown"
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: 0,
                  width: 240,
                  background: "#ffffff",
                  border: "1px solid #e5e9f0",
                  borderRadius: 14,
                  boxShadow: "0 8px 32px rgba(7,26,74,0.14), 0 2px 8px rgba(7,26,74,0.06)",
                  padding: 0,
                  zIndex: 9999,
                  overflow: "hidden",
                  animation: "profile-dropdown-in 0.2s cubic-bezier(0.16,1,0.3,1)",
                }}
              >
                {/* User Info */}
                <div style={{ padding: "14px 16px", background: "#F8FAFD", borderBottom: "1px solid #e5e9f0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <div
                      style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: "linear-gradient(135deg, #2455D6, #071A4A)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", fontSize: 14, fontWeight: 700, flexShrink: 0,
                      }}
                    >
                      {user?.firstName?.[0] || "A"}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#071A3D", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayName}</div>
                      <div style={{ fontSize: 11, color: "#66728F", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayEmail}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ fontSize: 11, color: "#66728F" }}>
                      <span style={{ fontWeight: 600, color: "#475569" }}>Role:</span> {displayRole}
                    </div>
                    {companyName && (
                      <div style={{ fontSize: 11, color: "#66728F" }}>
                        <span style={{ fontWeight: 600, color: "#475569" }}>Company:</span> {companyName}
                      </div>
                    )}
                    {branchName && (
                      <div style={{ fontSize: 11, color: "#66728F" }}>
                        <span style={{ fontWeight: 600, color: "#475569" }}>Branch:</span> {branchName}
                      </div>
                    )}
                  </div>
                </div>

                {/* Sign Out */}
                <div style={{ padding: "6px" }}>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-150"
                    style={{ color: "#DC2626", fontSize: 13, fontWeight: 500 }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#FEF2F2"; e.currentTarget.style.color = "#B91C1C"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#DC2626"; }}
                  >
                    <LogOut size={15} strokeWidth={1.8} />
                    <span>Sign out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

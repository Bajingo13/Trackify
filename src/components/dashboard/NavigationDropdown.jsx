import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export default function NavigationDropdown({
  label,
  children,
  isActive,
  activeChild,
  onSelectChild,
}) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const containerRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const close = useCallback(() => {
    setOpen(false);
    setHighlightedIndex(-1);
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (
        containerRef.current && !containerRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) {
        close();
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [close, open]);

  const updatePosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 6,
        left: rect.left,
      });
    }
  }, []);

  useEffect(() => {
    if (open) {
      updatePosition();
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }
  }, [open, updatePosition]);

  useEffect(() => {
    if (open && menuRef.current) {
      const activeIdx = children.findIndex((c) => c.path === activeChild);
      if (activeIdx >= 0) {
        setHighlightedIndex(activeIdx);
        const items = menuRef.current.querySelectorAll('[role="menuitem"]');
        items[activeIdx]?.focus();
      } else {
        setHighlightedIndex(0);
        const items = menuRef.current.querySelectorAll('[role="menuitem"]');
        items[0]?.focus();
      }
    }
  }, [open, activeChild, children]);

  function handleKeyDown(e) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    const items = menuRef.current?.querySelectorAll('[role="menuitem"]');
    if (!items) return;

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = highlightedIndex < items.length - 1 ? highlightedIndex + 1 : 0;
        setHighlightedIndex(next);
        items[next]?.focus();
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const prev = highlightedIndex > 0 ? highlightedIndex - 1 : items.length - 1;
        setHighlightedIndex(prev);
        items[prev]?.focus();
        break;
      }
      case "Home": {
        e.preventDefault();
        setHighlightedIndex(0);
        items[0]?.focus();
        break;
      }
      case "End": {
        e.preventDefault();
        setHighlightedIndex(items.length - 1);
        items[items.length - 1]?.focus();
        break;
      }
      case "Escape": {
        e.preventDefault();
        close();
        buttonRef.current?.focus();
        break;
      }
      case "Tab": {
        close();
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        if (highlightedIndex >= 0 && children[highlightedIndex]) {
          onSelectChild(children[highlightedIndex]);
          close();
        }
        break;
      }
      default:
        break;
    }
  }

  return (
    <div className="relative" ref={containerRef} onKeyDown={handleKeyDown}>
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className="nav-item flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-blue-400"
        style={{
          transition: "all 0.2s ease",
          ...(isActive
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
          if (!isActive) {
            e.currentTarget.style.background = "#EEF4FF";
            e.currentTarget.style.color = "#071A4A";
            e.currentTarget.style.borderColor = "#B5C8F5";
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive) {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "#66728F";
            e.currentTarget.style.borderColor = "transparent";
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
        <ChevronDown
          size={11}
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
          }}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onMouseLeave={() => setHighlightedIndex(-1)}
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              minWidth: 220,
              background: "var(--trackify-surface)",
              border: "1px solid var(--trackify-border)",
              borderRadius: 14,
              boxShadow: "0 8px 32px rgba(7,26,74,0.12)",
              padding: "6px",
              zIndex: 9999,
              animation: "nav-dropdown-in 0.15s ease",
            }}
          >
            {children.map((child, idx) => {
              const isChildActive = child.path === activeChild;
              const isHighlighted = highlightedIndex === idx;
              return (
                <button
                  key={child.path}
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    onSelectChild(child);
                    close();
                  }}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left"
                  style={{
                    transition: "all 0.2s ease",
                    ...(isHighlighted
                      ? {
                          background: "#EEF4FF",
                          color: "#071A4A",
                          border: "1px solid #B5C8F5",
                          boxShadow: "none",
                        }
                      : isChildActive
                      ? {
                          background: "#071A4A",
                          color: "#ffffff",
                          border: "1px solid #071A4A",
                          boxShadow: "none",
                        }
                      : {
                          background: "transparent",
                          color: "#071A3D",
                          border: "1px solid transparent",
                          boxShadow: "none",
                        }),
                  }}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-[13px] font-medium leading-tight">{child.label}</span>
                    {child.fullName && child.fullName !== child.label && (
                      <span
                        className="text-[11px] leading-tight mt-0.5"
                        style={{
                          color: isChildActive ? "rgba(255,255,255,0.7)" : isHighlighted ? "#4A6BC5" : "#66728F",
                          transition: "color 0.2s ease",
                        }}
                      >
                        {child.fullName}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";

/**
 * Standard dropdown/select control, styled from theme/tokens.css.
 *
 *   <Select value={priority} onChange={setPriority} options={[{ value: "normal", label: "Normal" }]} />
 *
 * `onChange` is called with the raw option value (like `e.target.value` from a native select).
 * Renders a portal-based listbox so menu radius/shadow/options can be styled consistently
 * everywhere, instead of relying on the browser's native <select> popup.
 */
export default function Select({
  value,
  onChange,
  defaultValue,
  name,
  required,
  options = [],
  placeholder = "Select…",
  disabled = false,
  error = false,
  size = "md",
  style,
  "aria-label": ariaLabel,
  id,
}) {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const currentValue = isControlled ? value : internalValue;

  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const typeaheadRef = useRef({ text: "", timer: null });

  const selectedIndex = options.findIndex((o) => o.value === currentValue);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const close = useCallback(() => {
    setOpen(false);
    setHighlighted(-1);
  }, []);

  /* Opening and the starting highlight happen together. When the highlight
     waited for an effect after the render, a quick ArrowDown + Enter landed
     first and picked the first option instead of the next one. */
  const openMenu = useCallback(() => {
    setHighlighted(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [selectedIndex]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight ?? 0;
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < menuH + 8 && rect.top > menuH + 8;
    setMenuPos({
      top: flipUp ? rect.top - menuH - 6 : rect.bottom + 6,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onScroll = () => updatePosition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e) {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) {
        close();
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open, close]);

  useEffect(() => {
    if (open) setHighlighted(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  function selectIndex(idx) {
    const opt = options[idx];
    if (!opt || opt.disabled) return;
    if (!isControlled) setInternalValue(opt.value);
    onChange?.(opt.value);
    close();
    triggerRef.current?.focus();
  }

  function moveHighlight(next) {
    let idx = next;
    for (let i = 0; i < options.length; i++) {
      if (!options[idx]?.disabled) break;
      idx = (idx + 1) % options.length;
    }
    setHighlighted(idx);
  }

  function handleTriggerKeyDown(e) {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveHighlight(highlighted < options.length - 1 ? highlighted + 1 : 0);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveHighlight(highlighted > 0 ? highlighted - 1 : options.length - 1);
        break;
      case "Home":
        e.preventDefault();
        moveHighlight(0);
        break;
      case "End":
        e.preventDefault();
        moveHighlight(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        selectIndex(highlighted);
        break;
      case "Escape":
        e.preventDefault();
        // Handled here. Without this the key carried on to the Modal around
        // the form, which closed too — losing everything typed into it.
        e.stopPropagation();
        close();
        break;
      case "Tab":
        close();
        break;
      default:
        if (e.key.length === 1) {
          const ta = typeaheadRef.current;
          clearTimeout(ta.timer);
          ta.text += e.key.toLowerCase();
          ta.timer = setTimeout(() => (ta.text = ""), 500);
          const match = options.findIndex((o) =>
            !o.disabled && o.label?.toLowerCase().startsWith(ta.text)
          );
          if (match >= 0) setHighlighted(match);
        }
        break;
    }
  }

  const SIZES = {
    sm: { padding: "6px 10px", fontSize: "var(--fs-12)" },
    md: { padding: "8px 11px", fontSize: "var(--fs-13)" },
  };
  const s = SIZES[size] || SIZES.md;

  return (
    <div style={{ position: "relative", display: "inline-flex", width: style?.width ?? "100%", ...style }}>
      {name && <input type="hidden" name={name} value={currentValue ?? ""} />}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => { if (disabled) return; if (open) close(); else openMenu(); }}
        onKeyDown={handleTriggerKeyDown}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: s.padding,
          fontSize: s.fontSize,
          fontFamily: "var(--font-sans)",
          color: selected ? "var(--text)" : "var(--text-3)",
          background: "var(--surface)",
          border: `1px solid ${error ? "var(--danger)" : "var(--line-strong)"}`,
          borderRadius: "var(--r-sm)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
          boxShadow: open ? "var(--ring)" : "none",
          textAlign: "left",
        }}
        onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "var(--surface-sunk)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface)"; }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          size={14}
          style={{
            flexShrink: 0,
            color: "var(--text-3)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform var(--dur-1) var(--ease-out)",
          }}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: 280,
              overflowY: "auto",
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-sm)",
              boxShadow: "var(--shadow-2)",
              padding: 4,
              zIndex: 9999,
            }}
          >
            {options.length === 0 && (
              <div style={{ padding: "8px 10px", fontSize: "var(--fs-12)", color: "var(--text-3)" }}>No options</div>
            )}
            {options.map((opt, idx) => {
              const isSelected = opt.value === currentValue;
              const isHighlighted = idx === highlighted;
              return (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled || undefined}
                  onMouseEnter={() => !opt.disabled && setHighlighted(idx)}
                  onClick={() => selectIndex(idx)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "8px 10px",
                    fontSize: "var(--fs-13)",
                    borderRadius: "var(--r-xs)",
                    cursor: opt.disabled ? "not-allowed" : "pointer",
                    opacity: opt.disabled ? 0.5 : 1,
                    color: isSelected ? "var(--accent)" : "var(--text)",
                    background: isHighlighted ? "var(--surface-sunk)" : isSelected ? "var(--accent-soft)" : "transparent",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.label}</span>
                  {isSelected && <Check size={14} style={{ flexShrink: 0 }} />}
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}

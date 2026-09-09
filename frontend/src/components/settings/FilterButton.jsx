import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { SlidersHorizontal, Check } from "lucide-react";
import { Button } from "../ui";

/**
 * A single-select filter with a small popover.
 *
 *   <FilterButton
 *     label="Status"
 *     value={status}
 *     options={[{value:"all",label:"All"},{value:"active",label:"Active"}]}
 *     onChange={setStatus}
 *   />
 *
 * The trigger shows the active option's label when it isn't the first
 * ("all") option.
 */
export default function FilterButton({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const active = options.find((o) => o.value === value);
  const isDefault = options[0]?.value === value;

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <Button
        variant="secondary"
        size="sm"
        icon={SlidersHorizontal}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {label}
        {!isDefault && active && (
          <span style={{ marginLeft: 6, color: "var(--accent)", fontWeight: 700 }}>· {active.label}</span>
        )}
      </Button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.14 }}
            style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 60, margin: 0,
              padding: 4, listStyle: "none", minWidth: 168, background: "var(--surface)",
              border: "1px solid var(--line)", borderRadius: "var(--r-md)", boxShadow: "var(--shadow-3)",
            }}
          >
            {options.map((o) => {
              const sel = o.value === value;
              return (
                <li key={o.value}>
                  <button
                    role="option"
                    aria-selected={sel}
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 9px",
                      border: "none", background: "transparent", cursor: "pointer", borderRadius: "var(--r-xs)",
                      fontSize: "var(--fs-13)", fontWeight: 500, color: "var(--text-2)", textAlign: "left",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <Check size={13} style={{ color: "var(--accent)", opacity: sel ? 1 : 0, flexShrink: 0 }} />
                    {o.label}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

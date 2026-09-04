import { forwardRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Loader2, Check } from "lucide-react";
import { springSnappy } from "../../motion";

/**
 * Button with real press feedback and async states.
 *
 *   <Button onClick={...}>Save</Button>
 *   <Button variant="primary" loading={saving}>Approve</Button>
 *   <Button variant="danger" size="sm" icon={Trash2}>Delete</Button>
 *
 * Pass `loading` while an action runs; pass `success` briefly to flash a check.
 */
const VARIANTS = {
  primary: {
    background: "var(--accent)", color: "var(--text-on-accent)",
    border: "1px solid transparent", boxShadow: "var(--shadow-1)",
    "--hover-bg": "var(--accent-hover)",
  },
  secondary: {
    background: "var(--surface)", color: "var(--text)",
    border: "1px solid var(--line-strong)",
    "--hover-bg": "var(--surface-sunk)",
  },
  ghost: {
    background: "transparent", color: "var(--text-2)", border: "1px solid transparent",
    "--hover-bg": "var(--surface-sunk)",
  },
  danger: {
    background: "var(--danger-soft)", color: "var(--danger)",
    border: "1px solid var(--danger-line)",
    "--hover-bg": "color-mix(in srgb, var(--danger-soft) 80%, var(--danger))",
  },
  "danger-solid": {
    background: "var(--danger)", color: "#fff", border: "1px solid transparent",
    "--hover-bg": "color-mix(in srgb, var(--danger) 85%, #000)",
  },
};

const SIZES = {
  sm: { padding: "5px 10px", fontSize: "var(--fs-12)", gap: 6, iconSize: 13, radius: "var(--r-sm)" },
  md: { padding: "8px 14px", fontSize: "var(--fs-13)", gap: 7, iconSize: 15, radius: "var(--r-sm)" },
  lg: { padding: "11px 18px", fontSize: "var(--fs-14)", gap: 8, iconSize: 16, radius: "var(--r-md)" },
};

const Button = forwardRef(function Button(
  { children, variant = "secondary", size = "md", icon: Icon, iconRight, loading, success, disabled, style, ...rest },
  ref
) {
  const v = VARIANTS[variant] || VARIANTS.secondary;
  const s = SIZES[size] || SIZES.md;
  const isDisabled = disabled || loading;

  return (
    <motion.button
      ref={ref}
      type="button"
      disabled={isDisabled}
      whileHover={isDisabled ? undefined : { y: -1, background: "var(--hover-bg)" }}
      whileTap={isDisabled ? undefined : { scale: 0.965, y: 0 }}
      transition={springSnappy}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        gap: s.gap, padding: s.padding, fontSize: s.fontSize, fontWeight: 600,
        fontFamily: "var(--font-sans)", borderRadius: s.radius, cursor: isDisabled ? "not-allowed" : "pointer",
        whiteSpace: "nowrap", opacity: isDisabled && !loading ? 0.55 : 1,
        outlineOffset: 2, position: "relative", lineHeight: 1.2,
        ...v, ...style,
      }}
      {...rest}
    >
      <AnimatePresence mode="wait" initial={false}>
        {loading ? (
          <motion.span
            key="l" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }}
            style={{ display: "inline-flex" }}
          >
            <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.8, ease: "linear", repeat: Infinity }} style={{ display: "inline-flex" }}>
              <Loader2 size={s.iconSize} />
            </motion.span>
          </motion.span>
        ) : success ? (
          <motion.span key="s" initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} style={{ display: "inline-flex" }}>
            <Check size={s.iconSize} />
          </motion.span>
        ) : (
          <motion.span
            key="c" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ display: "inline-flex", alignItems: "center", gap: s.gap }}
          >
            {Icon && <Icon size={s.iconSize} />}
            {children}
            {iconRight && iconRight}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
});

export default Button;

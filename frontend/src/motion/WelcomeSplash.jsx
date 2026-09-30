import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import "./welcome-splash.css";

const WORD = "Trackify".split("");
const EASE_OUT = [0.22, 1, 0.36, 1];

/**
 * Shown once, right after account setup succeeds (a new invitation accepted,
 * or a temporary password replaced) — before the person is sent back to sign
 * in with it. "Trackify" grows in letter by letter, centered, then this calls
 * onDone so the page can move on. There is no button: it is a hand-off, not a
 * screen to linger on.
 */
export default function WelcomeSplash({ onDone, subtitle = "You're all set. Sign in to continue." }) {
  const still = useReducedMotion();
  const holdMs = still ? 900 : 2200;

  useEffect(() => {
    const id = setTimeout(() => onDone?.(), holdMs);
    return () => clearTimeout(id);
  }, [onDone, holdMs]);

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: still ? 0 : 0.045, delayChildren: 0.15 } },
  };
  const letterVariant = {
    hidden: { opacity: 0, scale: still ? 1 : 0.25, y: still ? 0 : 14 },
    show: { opacity: 1, scale: 1, y: 0, transition: { duration: still ? 0 : 0.5, ease: EASE_OUT } },
  };

  return (
    <motion.div
      className="ws"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
      transition={{ duration: 0.3 }}
      role="status"
      aria-live="polite"
    >
      <motion.div className="ws-word" variants={container} initial="hidden" animate="show">
        {WORD.map((ch, i) => (
          <motion.span key={i} variants={letterVariant} className="ws-letter">
            {ch}
          </motion.span>
        ))}
      </motion.div>

      <motion.p
        className="ws-sub"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: still ? 0.1 : 0.85, ease: EASE_OUT }}
      >
        {subtitle}
      </motion.p>
    </motion.div>
  );
}

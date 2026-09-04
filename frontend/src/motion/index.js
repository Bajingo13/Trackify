/**
 * Trackify motion system — shared presets so animation is consistent, not ad-hoc.
 * Durations mirror the --dur-* tokens; springs are tuned once here.
 *
 *   import { fadeUp, stagger, springSnappy } from "../motion";
 *   <motion.div variants={fadeUp} initial="hidden" animate="show" />
 */

export const springSnappy = { type: "spring", stiffness: 520, damping: 34, mass: 0.9 };
export const springSoft = { type: "spring", stiffness: 260, damping: 26 };
export const springGentle = { type: "spring", stiffness: 170, damping: 22 };

export const easeOut = [0.22, 1, 0.36, 1];
export const easeEmphasis = [0.2, 0.8, 0.2, 1];

/* enter / exit */
export const fade = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.18 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

export const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.26, ease: easeOut } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.14 } },
};

export const scaleIn = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: springSnappy },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.12 } },
};

/* list orchestration */
export const stagger = (gap = 0.028, delay = 0.04) => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
});

export const staggerItem = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: easeOut } },
};

/* page-level route transition */
export const pageTransition = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: easeOut } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.14, ease: "easeIn" } },
};

/* drawer / sheet from the right */
export const drawerRight = {
  hidden: { x: "100%" },
  show: { x: 0, transition: springSoft },
  exit: { x: "100%", transition: { duration: 0.18, ease: "easeIn" } },
};

export const backdrop = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.16 } },
  exit: { opacity: 0, transition: { duration: 0.14 } },
};

/* button gesture presets */
export const pressable = {
  whileHover: { y: -1 },
  whileTap: { scale: 0.97, y: 0 },
  transition: springSnappy,
};

/* a value flash (new row, changed status) */
export const flash = {
  initial: { backgroundColor: "rgba(36,85,214,0.14)" },
  animate: { backgroundColor: "rgba(36,85,214,0)", transition: { duration: 1.1, ease: "easeOut" } },
};

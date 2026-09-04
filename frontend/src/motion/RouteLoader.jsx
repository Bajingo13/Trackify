import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ShieldCheck } from "lucide-react";
import "./route-loader.css";

/**
 * Sign-in hand-off loader — a shipment-style checkpoint flow (distinct from the
 * truck animation on the login hero). Wrap in <AnimatePresence> for the exit fade.
 */
export default function RouteLoader({ label = "Signing you in" }) {
  const [progress, setProgress] = useState(5);
  useEffect(() => {
    const id = requestAnimationFrame(() => setProgress(100));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <motion.div
      className="rl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <motion.div
        className="rl-card"
        initial={{ scale: 0.9, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 26 }}
      >
        <div className="rl-badge">
          <ShieldCheck size={20} strokeWidth={2.2} />
          <span className="rl-badge-scan" />
        </div>

        <div className="rl-flow">
          <div className="rl-flow-track" />
          <div className="rl-flow-fill" />
          <span className="rl-node" />
          <span className="rl-node" />
          <span className="rl-node" />
          <span className="rl-node" />
        </div>

        <div className="rl-label">{label}<span className="rl-dots"><i /><i /><i /></span></div>
        <div className="rl-bar"><span style={{ width: `${progress}%` }} /></div>
      </motion.div>
    </motion.div>
  );
}

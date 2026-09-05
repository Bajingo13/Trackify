import { useEffect, useRef, useState } from "react";
import { motion, animate } from "motion/react";
import { LineChart, Line, ResponsiveContainer } from "recharts";

function CountUp({ value }) {
  const [n, setN] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const c = animate(prev.current, value, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setN(Math.round(v)),
    });
    prev.current = value;
    return () => c.stop();
  }, [value]);
  return <>{n.toLocaleString("en-US")}</>;
}

/**
 * Dashboard KPI card.
 *
 * Monochrome by design — the figure carries the card, so a row of KPIs reads
 * as one block instead of four competing colours. `color`/`iconBg` are still
 * accepted so no call site breaks; they are no longer used for decoration.
 *
 * There is no trend badge: the summary has no period-over-period figure, and
 * a hardcoded delta would be inventing one.
 */
export default function KPICard({
  label, value, changeLabel, color, sparkData, subtitle, icon, iconBg, index = 0,
}) {
  void color; void iconBg;
  const data = (sparkData || []).map((v, i) => ({ i, v }));
  const hasSpark = data.some((d) => d.v > 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.34, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
      className="card p-5 flex flex-col gap-3"
      style={{ transition: "box-shadow .2s, border-color .2s", position: "relative" }}
    >
      {icon && (
        <span
          aria-hidden="true"
          style={{ position: "absolute", top: 20, right: 20, color: "var(--text-3)", display: "inline-flex" }}
        >
          {icon}
        </span>
      )}

      <div className="flex flex-col gap-0.5 min-w-0" style={{ paddingRight: 26 }}>
        <span
          style={{
            fontSize: "var(--fs-11)", fontWeight: 600, color: "var(--text-3)",
            textTransform: "uppercase", letterSpacing: ".06em",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}
        >
          {label}
        </span>
        <span
          className="tk-statnum"
          style={{
            fontSize: "var(--fs-32)", fontWeight: 700, lineHeight: 1.05,
            letterSpacing: "-0.02em", color: "var(--text)", fontVariantNumeric: "tabular-nums",
          }}
        >
          <CountUp value={value} />
        </span>
        {(changeLabel || subtitle) && (
          <span
            style={{
              fontSize: "var(--fs-11)", color: "var(--text-3)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}
          >
            {changeLabel || subtitle}
          </span>
        )}
      </div>

      {/* 7-day shape — a quiet reference line, not a second colour */}
      {hasSpark && (
        <div className="h-9 -mx-1" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <Line
                type="monotone"
                dataKey="v"
                stroke="var(--line-strong)"
                strokeWidth={2}
                dot={false}
                isAnimationActive
                animationDuration={1100}
                animationEasing="ease-out"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </motion.div>
  );
}

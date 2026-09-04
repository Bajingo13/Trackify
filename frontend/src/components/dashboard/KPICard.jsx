import { useEffect, useRef, useState } from "react";
import { motion, animate } from "motion/react";
import { TrendingUp, TrendingDown } from "lucide-react";
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

export default function KPICard({
  label, value, change, changeLabel, color, sparkData, subtitle, icon, iconBg, index = 0,
}) {
  const isPositive = change >= 0;
  const data = sparkData.map((v, i) => ({ i, v }));
  const Delta = isPositive ? TrendingUp : TrendingDown;
  const deltaColor = isPositive ? "#2D8A4E" : "#C53030";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.34, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
      className="card p-5 flex flex-col gap-3 min-h-[164px]"
      style={{ transition: "box-shadow .2s, border-color .2s" }}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: iconBg }}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="tk-eyebrow" style={{ marginBottom: 4 }}>{label}</div>
          <div className="tk-statnum leading-tight truncate" style={{ fontSize: 26, color: "var(--trackify-text)" }}>
            <CountUp value={value} />
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <span
              className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
              style={{ color: deltaColor, background: isPositive ? "#E6F4EC" : "#FCEAEA" }}
            >
              <Delta size={10} />
              {Math.abs(change)}%
            </span>
            <span className="text-[11px]" style={{ color: "var(--trackify-text-secondary)" }}>
              {changeLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="h-12 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <Line
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={2.2}
              dot={false}
              isAnimationActive
              animationDuration={1100}
              animationEasing="ease-out"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}

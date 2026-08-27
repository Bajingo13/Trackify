import { TrendingUp } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";

export default function KPICard({
  label, value, change, changeLabel, color, sparkData, subtitle, icon, iconBg,
}) {
  const isPositive = change > 0;
  const absChange = Math.abs(change);
  const data = sparkData.map((v, i) => ({ i, v }));

  return (
    <div className="card p-5 flex flex-col gap-3 min-h-[160px] transition-shadow duration-200">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: iconBg }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium mb-1" style={{ color: "var(--trackify-text-secondary)" }}>
            {label}
          </div>
          <div className="text-2xl font-bold leading-tight truncate" style={{ color: "var(--trackify-text)" }}>
            {value.toLocaleString("en-US")}
          </div>
          <div className="flex items-center gap-1 mt-1">
            {change > 0 && (
              <>
                <TrendingUp size={11} style={{ color: "#2D8A4E" }} />
                <span className="text-[11px] font-semibold" style={{ color: "#2D8A4E" }}>
                  ↑ {absChange}%
                </span>
              </>
            )}
            <span className="text-[11px]" style={{ color: "var(--trackify-text-secondary)" }}>
              {changeLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="h-12 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <Tooltip
              content={() => null}
              cursor={false}
            />
            <Line
              type="monotone"
              dataKey="v"
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, fill: color }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

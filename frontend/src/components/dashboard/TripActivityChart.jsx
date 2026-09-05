import { useState } from "react";
import { Info, ChevronDown } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { tripActivityData as ACTIVITY_STUB } from "../../data/dashboardData";

const timeOptions = ["Last 7 days", "Last 30 days", "Monthly", "Quarterly", "Yearly"];

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="px-4 py-3 rounded-xl text-sm"
      style={{
        background: "var(--trackify-navy)",
        color: "#fff",
        boxShadow: "0 8px 24px rgba(7,26,74,0.24)",
        minWidth: 180,
      }}
    >
      <div className="font-semibold mb-2 text-xs opacity-70">{label}, 2026</div>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center justify-between gap-4 mb-1">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: entry.color }} />
            {entry.dataKey === "completed" ? "Arrived" : entry.dataKey === "departed" ? "Departed" : "Late"}
          </span>
          <span className="font-semibold">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function CustomLegend({ payload }) {
  return (
    <div className="flex items-center gap-4">
      {payload?.map((entry) => (
        <span key={entry.dataKey} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "#6F7894" }}>
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: entry.color }} />
          {entry.dataKey === "completed" ? "Arrived" : entry.dataKey === "departed" ? "Departed" : "Late"}
        </span>
      ))}
    </div>
  );
}

export default function TripActivityChart({ data }) {
  const tripActivityData = Array.isArray(data) && data.length ? data : ACTIVITY_STUB;
  const [timeRange, setTimeRange] = useState("Last 7 days");
  const [dropOpen, setDropOpen] = useState(false);

  const totalCompleted = tripActivityData.reduce((s, d) => s + d.completed, 0);
  const totalInTransit = tripActivityData.reduce((s, d) => s + (d.departed || 0), 0);
  const totalDelayed = tripActivityData.reduce((s, d) => s + d.delayed, 0);

  return (
    <div className="card p-6 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-base" style={{ color: "var(--trackify-text)" }}>Trip Activity Overview</span>
          <button aria-label="Trip activity info" className="opacity-50 hover:opacity-80 transition-opacity">
            <Info size={14} />
          </button>
        </div>
        <div className="relative">
          <button
            onClick={() => setDropOpen(!dropOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: "#F5F8FE",
              border: "1px solid var(--trackify-border)",
              color: "var(--trackify-text)",
            }}
          >
            {timeRange}
            <ChevronDown size={11} style={{ color: "var(--trackify-text-secondary)" }} />
          </button>
          {dropOpen && (
            <div
              className="absolute right-0 mt-1 py-1 w-36 rounded-xl z-40"
                style={{
                  background: "#fff",
                  border: "1px solid var(--trackify-border)",
                  boxShadow: "0 8px 24px rgba(7,26,74,0.1)",
                }}
            >
              {timeOptions.map((opt) => (
                <button
                  key={opt}
                  className="w-full text-left px-3 py-1.5 text-xs transition-colors"
                  style={{ color: opt === timeRange ? "#2455D6" : "var(--trackify-text)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(36,85,214,0.05)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  onClick={() => { setTimeRange(opt); setDropOpen(false); }}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <CustomLegend payload={[
        { dataKey: "completed", color: "var(--accent)" },
        { dataKey: "departed", color: "var(--line-strong)" },
        { dataKey: "delayed", color: "var(--warn)" },
      ]} />

      {/* Chart */}
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={tripActivityData} barCategoryGap="30%" barGap={4}>
            <defs>
              <linearGradient id="completedGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2455D6" />
                <stop offset="100%" stopColor="#3F68D8" stopOpacity={0.7} />
              </linearGradient>
              <linearGradient id="transitGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7596EA" />
                <stop offset="100%" stopColor="#B5C8F5" stopOpacity={0.7} />
              </linearGradient>
              <linearGradient id="delayedGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#D4A017" />
                <stop offset="100%" stopColor="#E8C547" stopOpacity={0.7} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--trackify-border-soft)" strokeDasharray="0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "var(--trackify-text-secondary)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--trackify-text-secondary)" }}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(36,85,214,0.04)", radius: 6 }} />
            <Bar dataKey="completed" fill="url(#completedGrad)" radius={[6, 6, 0, 0]} maxBarSize={28} />
            <Bar dataKey="departed" fill="url(#transitGrad)" radius={[6, 6, 0, 0]} maxBarSize={28} />
            <Bar dataKey="delayed" fill="url(#delayedGrad)" radius={[6, 6, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Footer */}
      <div className="flex items-end justify-between gap-4 pt-2 border-t" style={{ borderColor: "var(--trackify-border)" }}>
        <div className="flex items-center gap-8">
          <div>
            <div className="text-xs mb-1" style={{ color: "var(--trackify-text-secondary)" }}>Completed</div>
            <div className="text-lg font-bold" style={{ color: "var(--trackify-text)" }}>{totalCompleted}</div>
          </div>
          <div>
            <div className="text-xs mb-1" style={{ color: "var(--trackify-text-secondary)" }}>In Transit</div>
            <div className="text-lg font-bold" style={{ color: "var(--trackify-text)" }}>{totalInTransit}</div>
          </div>
          <div>
            <div className="text-xs mb-1" style={{ color: "var(--trackify-text-secondary)" }}>Delayed</div>
            <div className="text-lg font-bold" style={{ color: "var(--trackify-text)" }}>{totalDelayed}</div>
          </div>
        </div>
        <button
          className="text-xs font-semibold flex items-center gap-1 transition-opacity hover:opacity-70"
          style={{ color: "#2455D6" }}
        >
          View full report →
        </button>
      </div>
    </div>
  );
}

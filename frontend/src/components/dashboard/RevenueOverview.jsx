import { useState } from "react";
import { Info, ChevronDown } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { revenueChartData } from "../../data/dashboardData";

const timeOptions = ["Last 7 days", "Last 30 days", "Monthly", "Quarterly", "Yearly"];

function formatY(value) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const rev = payload.find((p) => p.dataKey === "revenue");
  const exp = payload.find((p) => p.dataKey === "expenses");
  const net = (rev?.value || 0) - (exp?.value || 0);
  return (
    <div
      className="px-4 py-3 rounded-xl text-sm"
      style={{
        background: "#101B3D",
        color: "#fff",
        boxShadow: "0 8px 24px rgba(16,27,61,0.24)",
        minWidth: 180,
      }}
    >
      <div className="font-semibold mb-2 text-xs opacity-70">{label}, 2026</div>
      <div className="flex items-center justify-between gap-4 mb-1">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: "#1464F4" }} />
          Revenue
        </span>
        <span className="font-semibold">${(rev?.value || 0).toLocaleString()}</span>
      </div>
      <div className="flex items-center justify-between gap-4 mb-1">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: "#7B3FF2" }} />
          Expenses
        </span>
        <span className="font-semibold">${(exp?.value || 0).toLocaleString()}</span>
      </div>
      <div
        className="flex items-center justify-between gap-4 pt-2 mt-1 border-t border-white border-opacity-10 font-semibold"
      >
        <span>Net</span>
        <span>${net.toLocaleString()}</span>
      </div>
    </div>
  );
}

export default function RevenueOverview() {
  const [timeRange, setTimeRange] = useState("Last 7 days");
  const [dropOpen, setDropOpen] = useState(false);

  return (
    <div className="card p-6 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-base" style={{ color: "#101B3D" }}>Revenue Overview</span>
          <button aria-label="Revenue overview info" className="opacity-50 hover:opacity-80 transition-opacity">
            <Info size={14} />
          </button>
        </div>
        <div className="relative">
          <button
            onClick={() => setDropOpen(!dropOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              background: "#F5F7FF",
              border: "1px solid rgba(20,100,244,0.1)",
              color: "#101B3D",
            }}
          >
            {timeRange}
            <ChevronDown size={11} style={{ color: "#6F7894" }} />
          </button>
          {dropOpen && (
            <div
              className="absolute right-0 mt-1 py-1 w-36 rounded-xl z-40"
              style={{
                background: "#fff",
                border: "1px solid rgba(20,100,244,0.1)",
                boxShadow: "0 8px 24px rgba(16,27,61,0.1)",
              }}
            >
              {timeOptions.map((opt) => (
                <button
                  key={opt}
                  className="w-full text-left px-3 py-1.5 text-xs transition-colors"
                  style={{ color: opt === timeRange ? "#1464F4" : "#101B3D" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(20,100,244,0.05)"; }}
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
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "#6F7894" }}>
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#1464F4" }} />
          Revenue
        </span>
        <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "#6F7894" }}>
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#7B3FF2" }} />
          Expenses
        </span>
      </div>

      {/* Chart */}
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={revenueChartData} barCategoryGap="30%" barGap={4}>
            <defs>
              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1464F4" />
                <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.7} />
              </linearGradient>
              <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7B3FF2" />
                <stop offset="100%" stopColor="#A855F7" stopOpacity={0.7} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(16,27,61,0.06)" strokeDasharray="0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#6F7894" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={formatY}
              tick={{ fontSize: 11, fill: "#6F7894" }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(20,100,244,0.04)", radius: 6 }} />
            <Bar dataKey="revenue" fill="url(#revGrad)" radius={[6, 6, 0, 0]} maxBarSize={28} />
            <Bar dataKey="expenses" fill="url(#expGrad)" radius={[6, 6, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Footer */}
      <div className="flex items-end justify-between gap-4 pt-2 border-t" style={{ borderColor: "rgba(20,100,244,0.08)" }}>
        <div className="flex items-center gap-8">
          <div>
            <div className="text-xs mb-1" style={{ color: "#6F7894" }}>Total Revenue</div>
            <div className="text-lg font-bold" style={{ color: "#101B3D" }}>$6,542,210</div>
          </div>
          <div>
            <div className="text-xs mb-1" style={{ color: "#6F7894" }}>Total Expenses</div>
            <div className="text-lg font-bold" style={{ color: "#101B3D" }}>$3,421,890</div>
          </div>
        </div>
        <button
          className="text-xs font-semibold flex items-center gap-1 transition-opacity hover:opacity-70"
          style={{ color: "#1464F4" }}
        >
          View full report →
        </button>
      </div>
    </div>
  );
}

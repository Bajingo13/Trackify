import { Info } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Can } from "../../auth/permissions";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { tripActivityData as ACTIVITY_STUB } from "../../data/dashboardData";

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
  const navigate = useNavigate();
  const tripActivityData = Array.isArray(data) && data.length ? data : ACTIVITY_STUB;

  const totalCompleted = tripActivityData.reduce((s, d) => s + d.completed, 0);
  const totalDeparted = tripActivityData.reduce((s, d) => s + (d.departed || 0), 0);
  const totalDelayed = tripActivityData.reduce((s, d) => s + d.delayed, 0);

  return (
    <div className="card p-5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-base" style={{ color: "var(--trackify-text)" }}>Trip Activity Overview</span>
          <span aria-label="Trip activity info" title="Actual departures, arrivals, and late arrivals from the last 7 days" className="opacity-50">
            <Info size={14} />
          </span>
        </div>
        <span className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "var(--surface-sunk)", border: "1px solid var(--line)", color: "var(--text)" }}>
          Last 7 days
        </span>
      </div>

      {/* Legend */}
      <CustomLegend payload={[
        { dataKey: "completed", color: "var(--accent)" },
        { dataKey: "departed", color: "var(--line-strong)" },
        { dataKey: "delayed", color: "var(--warn)" },
      ]} />

      {/* Chart */}
      <div className="flex-1 min-h-[196px]">
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
            <div className="text-xs mb-1" style={{ color: "var(--trackify-text-secondary)" }}>Arrived</div>
            <div className="text-lg font-bold" style={{ color: "var(--trackify-text)" }}>{totalCompleted}</div>
          </div>
          <div>
            <div className="text-xs mb-1" style={{ color: "var(--trackify-text-secondary)" }}>Departed</div>
            <div className="text-lg font-bold" style={{ color: "var(--trackify-text)" }}>{totalDeparted}</div>
          </div>
          <div>
            <div className="text-xs mb-1" style={{ color: "var(--trackify-text-secondary)" }}>Late</div>
            <div className="text-lg font-bold" style={{ color: "var(--trackify-text)" }}>{totalDelayed}</div>
          </div>
        </div>
        <Can permission="report.operations">
          <button
            className="text-xs font-semibold flex items-center gap-1 transition-opacity hover:opacity-70"
            style={{ color: "#2455D6" }}
            onClick={() => navigate("/reports/operations")}
          >
            View full report →
          </button>
        </Can>
      </div>
    </div>
  );
}

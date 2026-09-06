import { TrendingUp, FileCheck } from "lucide-react";
import { deliveryPerformance } from "../../data/dashboardData";

export default function DeliveryPerformance() {
  const { onTimePercent, previousChange, podCompleted, podTotal } = deliveryPerformance;
  const podPercent = podTotal > 0 ? Math.round((podCompleted / podTotal) * 100) : 0;

  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-base" style={{ color: "var(--trackify-text)" }}>Delivery Performance</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* On-Time Delivery */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--trackify-surface-blue)" }}>
              <TrendingUp size={16} style={{ color: "#2455D6" }} />
            </div>
            <span className="text-xs font-medium" style={{ color: "var(--trackify-text-secondary)" }}>On-Time Delivery</span>
          </div>
          <div className="text-2xl font-bold" style={{ color: "var(--trackify-text)" }}>{onTimePercent}%</div>
          <div className="flex items-center gap-1">
            <TrendingUp size={11} style={{ color: "#2D8A4E" }} />
            <span className="text-[11px] font-semibold" style={{ color: "#2D8A4E" }}>
              ↑ {previousChange}% vs previous period
            </span>
          </div>
        </div>

        {/* POD Completion */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--trackify-surface-blue)" }}>
              <FileCheck size={16} style={{ color: "#1F4BC6" }} />
            </div>
            <span className="text-xs font-medium" style={{ color: "var(--trackify-text-secondary)" }}>POD Completion</span>
          </div>
          <div className="text-2xl font-bold" style={{ color: "var(--trackify-text)" }}>
            {podCompleted} / {podTotal}
          </div>
          <div className="text-[11px] font-semibold" style={{ color: "var(--trackify-blue)" }}>
            {podPercent}% completed
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-medium" style={{ color: "var(--trackify-text-secondary)" }}>POD Progress</span>
          <span className="text-[11px] font-semibold" style={{ color: "var(--trackify-text)" }}>{podPercent}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--trackify-border-soft)" }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${podPercent}%`,
              background: "linear-gradient(90deg,#2455D6,#3F68D8)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

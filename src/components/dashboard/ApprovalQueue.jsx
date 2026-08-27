import { FileText, Receipt, ArrowLeftRight, ChevronRight } from "lucide-react";
import { approvalQueue } from "../../data/dashboardData";

const icons = {
  "Trip Tickets": <FileText size={16} style={{ color: "#2455D6" }} />,
  "Expense Reviews": <Receipt size={16} style={{ color: "#1F4BC6" }} />,
  "Branch Transfer": <ArrowLeftRight size={16} style={{ color: "#102F8A" }} />,
};

const iconBgs = {
  "Trip Tickets": "#EEF4FF",
  "Expense Reviews": "#E8F0FE",
  "Branch Transfer": "#EDF2FF",
};

export default function ApprovalQueue() {
  return (
    <div className="card p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-base" style={{ color: "var(--trackify-text)" }}>Approval Queue</span>
        <button className="text-xs font-semibold transition-opacity hover:opacity-70" style={{ color: "var(--trackify-blue)" }}>
          View queue
        </button>
      </div>

      <div className="flex flex-col divide-y" style={{ borderColor: "var(--trackify-border-soft)" }}>
        {approvalQueue.map((item) => (
          <div
            key={item.type}
            className="flex items-center justify-between gap-3 py-3 first:pt-0 cursor-pointer group"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-opacity group-hover:opacity-80"
                style={{ background: iconBgs[item.type] }}
              >
                {icons[item.type]}
              </div>
              <div>
                <div className="text-sm font-semibold leading-tight" style={{ color: "var(--trackify-text)" }}>
                  {item.count} {item.type}
                </div>
                <div className="text-xs mt-0.5" style={{ color: "var(--trackify-text-secondary)" }}>
                  {item.detail}
                </div>
              </div>
            </div>
            <ChevronRight size={14} style={{ color: "var(--trackify-text-muted)" }} className="flex-shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
          </div>
        ))}
      </div>
    </div>
  );
}

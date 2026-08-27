import { useState } from "react";
import { Landmark, Monitor, RefreshCw, ShoppingCart } from "lucide-react";
import { transactions, heatmapDates } from "../../data/dashboardData";

const categoryIcons = {
  bank: <Landmark size={13} />,
  monitor: <Monitor size={13} />,
  refresh: <RefreshCw size={13} />,
  "shopping-cart": <ShoppingCart size={13} />,
};

const heatmapColors = [
  "transparent",
  "rgba(123,63,242,0.1)",
  "rgba(123,63,242,0.2)",
  "rgba(123,63,242,0.35)",
  "rgba(123,63,242,0.55)",
  "rgba(20,100,244,0.55)",
  "rgba(20,100,244,0.7)",
  "rgba(20,100,244,0.85)",
  "#1464F4",
  "#0F52D6",
];

function getHeatColor(value) {
  const idx = Math.min(value, heatmapColors.length - 1);
  return heatmapColors[idx];
}

function HeatCell({ value, date, txId }) {
  const [hovered, setHovered] = useState(false);
  const color = getHeatColor(value);
  const isEmpty = value === 0;

  return (
    <div className="relative">
      <div
        className="rounded-lg cursor-pointer transition-all duration-150"
        style={{
          width: 72,
          height: 32,
          background: isEmpty ? "rgba(20,100,244,0.05)" : color,
          border: `1px solid ${isEmpty ? "rgba(20,100,244,0.06)" : "transparent"}`,
          transform: hovered && !isEmpty ? "scale(1.05)" : "scale(1)",
        }}
        onMouseEnter={() => !isEmpty && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={isEmpty ? "" : `${date} • ${txId} • ${value} transaction${value !== 1 ? "s" : ""}`}
        aria-label={isEmpty ? undefined : `${txId} on ${date}: ${value} transactions`}
      />
      {hovered && !isEmpty && (
        <div
          className="absolute z-50 px-3 py-2 rounded-lg text-xs whitespace-nowrap pointer-events-none"
          style={{
            background: "#101B3D",
            color: "#fff",
            bottom: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
            boxShadow: "0 4px 16px rgba(16,27,61,0.2)",
          }}
        >
          <div className="font-semibold">{date}</div>
          <div className="opacity-70">{value} transaction{value !== 1 ? "s" : ""}</div>
        </div>
      )}
    </div>
  );
}

const legendColors = [
  "rgba(20,100,244,0.05)",
  "rgba(123,63,242,0.1)",
  "rgba(123,63,242,0.25)",
  "rgba(123,63,242,0.45)",
  "#7B3FF2",
  "#1464F4",
];

export default function RecentTransactions() {
  return (
    <div className="card p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-base" style={{ color: "#101B3D" }}>Recent Transactions</span>
        <button className="text-xs font-semibold transition-opacity hover:opacity-70" style={{ color: "#1464F4" }}>
          View all transactions
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th className="text-left text-[11px] font-medium pb-2 pr-4" style={{ color: "#6F7894", width: 140 }}>
                Date / Transaction
              </th>
              {heatmapDates.map((d) => (
                <th
                  key={d}
                  className="text-center text-[11px] font-medium pb-2 px-1"
                  style={{ color: "#6F7894", width: 80 }}
                >
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id}>
                <td className="py-1 pr-4">
                  <div className="flex items-center gap-2">
                    <span style={{ color: "#6F7894" }}>{categoryIcons[tx.category]}</span>
                    <span className="text-xs font-medium" style={{ color: "#101B3D" }}>{tx.id}</span>
                  </div>
                </td>
                {heatmapDates.map((d) => (
                  <td key={d} className="py-1 px-1 text-center">
                    <div className="flex justify-center">
                      <HeatCell value={tx.dates[d] ?? 0} date={d} txId={tx.id} />
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-2 pt-1">
        <span className="text-[11px]" style={{ color: "#6F7894" }}>Less Activity</span>
        {legendColors.map((c, i) => (
          <div
            key={i}
            className="rounded"
            style={{
              width: 18,
              height: 14,
              background: c,
              border: "1px solid rgba(20,100,244,0.08)",
            }}
          />
        ))}
        <span className="text-[11px]" style={{ color: "#6F7894" }}>More Activity</span>
      </div>
    </div>
  );
}

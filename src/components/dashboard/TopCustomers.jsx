import { topCustomers } from "../../data/dashboardData";

const avatarColors = [
  { bg: "rgba(20,100,244,0.12)", text: "#1464F4" },
  { bg: "rgba(123,63,242,0.12)", text: "#7B3FF2" },
  { bg: "rgba(20,100,244,0.12)", text: "#1464F4" },
  { bg: "rgba(123,63,242,0.12)", text: "#7B3FF2" },
  { bg: "rgba(59,130,246,0.12)", text: "#2563EB" },
];

export default function TopCustomers() {
  const max = topCustomers[0].revenue;

  return (
    <div className="card p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-base" style={{ color: "#101B3D" }}>Top Customers</span>
        <button className="text-xs font-semibold transition-opacity hover:opacity-70" style={{ color: "#1464F4" }}>
          View all
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {topCustomers.map((customer, i) => {
          const pct = (customer.revenue / max) * 100;
          const { bg, text } = avatarColors[i % avatarColors.length];
          return (
            <button
              key={customer.name}
              className="flex items-center gap-3 w-full text-left group"
              aria-label={`${customer.name}, $${customer.revenue.toLocaleString()}`}
            >
              {/* Avatar */}
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold transition-opacity group-hover:opacity-80"
                style={{ background: bg, color: text }}
              >
                {customer.initials}
              </div>

              {/* Name + bar */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium mb-1.5 leading-none" style={{ color: "#101B3D" }}>
                  {customer.name}
                </div>
                <div
                  className="h-1 rounded-full"
                  style={{ background: "rgba(20,100,244,0.08)", maxWidth: "100%" }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${pct}%`,
                      background: i % 2 === 0
                        ? "linear-gradient(90deg,#1464F4,#3B82F6)"
                        : "linear-gradient(90deg,#7B3FF2,#A855F7)",
                    }}
                  />
                </div>
              </div>

              {/* Amount */}
              <div className="text-sm font-semibold flex-shrink-0" style={{ color: "#101B3D" }}>
                ${customer.revenue.toLocaleString()}.00
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

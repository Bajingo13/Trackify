import { useNavigate } from "react-router-dom";

const statusColors = {
  "For Approval": { bg: "rgba(212,160,23,0.1)", text: "#9A7B11", dot: "#D4A017" },
  "Approved": { bg: "rgba(36,85,214,0.1)", text: "#2455D6", dot: "#2455D6" },
  "Assigned": { bg: "rgba(31,75,198,0.1)", text: "#1F4BC6", dot: "#1F4BC6" },
  "In Transit": { bg: "rgba(36,85,214,0.1)", text: "#2455D6", dot: "#2455D6" },
  "Delivered": { bg: "rgba(45,138,78,0.1)", text: "#2D8A4E", dot: "#2D8A4E" },
  "Delayed": { bg: "rgba(180,120,20,0.1)", text: "#9A7B11", dot: "#D4A017" },
  "Exception": { bg: "rgba(197,48,48,0.1)", text: "#C53030", dot: "#C53030" },
};

export default function ActiveTrips({ trips }) {
  const navigate = useNavigate();
  const rows = trips || [];
  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-base" style={{ color: "var(--trackify-text)" }}>Recent / Active Trips</span>
        <button className="text-xs font-semibold transition-opacity hover:opacity-70" style={{ color: "var(--trackify-blue)" }} onClick={() => navigate("/operations/trips")}>
          View all trips
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="text-xs py-6 text-center" style={{ color: "var(--trackify-text-secondary)" }}>
          No approved or in-transit trips right now.
        </div>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th className="text-left text-[11px] font-medium pb-2 pr-4" style={{ color: "var(--trackify-text-secondary)" }}>Trip Ticket</th>
              <th className="text-left text-[11px] font-medium pb-2 pr-4" style={{ color: "var(--trackify-text-secondary)" }}>Route</th>
              <th className="text-left text-[11px] font-medium pb-2 pr-4" style={{ color: "var(--trackify-text-secondary)" }}>Driver</th>
              <th className="text-left text-[11px] font-medium pb-2 pr-4" style={{ color: "var(--trackify-text-secondary)" }}>Vehicle</th>
              <th className="text-left text-[11px] font-medium pb-2 pr-4" style={{ color: "var(--trackify-text-secondary)" }}>ETA</th>
              <th className="text-left text-[11px] font-medium pb-2" style={{ color: "var(--trackify-text-secondary)" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((trip) => {
              const sc = statusColors[trip.status] || statusColors["Assigned"];
              return (
                <tr
                  key={trip.id}
                  className="group cursor-pointer"
                  onClick={() => navigate(`/operations/trips?trip=${encodeURIComponent(trip.id)}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(`/operations/trips?trip=${encodeURIComponent(trip.id)}`);
                    }
                  }}
                  tabIndex={0}
                  aria-label={`Open trip ${trip.ticketNo || trip.id}`}
                  style={{ borderBottom: "1px solid var(--trackify-border-soft)" }}
                >
                  <td className="py-2.5 pr-4">
                    <span className="text-sm font-semibold" style={{ color: "var(--trackify-blue)" }}>{trip.ticketNo || trip.id}</span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="text-sm" style={{ color: "var(--trackify-text)" }}>{trip.route}</span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="text-sm" style={{ color: "var(--trackify-text)" }}>{trip.driver}</span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="text-sm font-medium" style={{ color: "var(--trackify-text-secondary)" }}>{trip.vehicle}</span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="text-sm" style={{ color: "var(--trackify-text)" }}>{trip.eta}</span>
                  </td>
                  <td className="py-2.5">
                    <span
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                      style={{ background: sc.bg, color: sc.text }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.dot }} />
                      {trip.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

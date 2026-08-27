import { Route, Navigation, Clock, AlertTriangle } from "lucide-react";
import TopNav from "../components/dashboard/TopNav";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import KPICard from "../components/dashboard/KPICard";
import TripActivityChart from "../components/dashboard/TripActivityChart";
import FleetAvailability from "../components/dashboard/FleetAvailability";
import ActiveTrips from "../components/dashboard/ActiveTrips";
import TopRoutes from "../components/dashboard/TopRoutes";
import ApprovalQueue from "../components/dashboard/ApprovalQueue";
import OperationalAlerts from "../components/dashboard/OperationalAlerts";
import DeliveryPerformance from "../components/dashboard/DeliveryPerformance";
import { kpiCards, dateRange } from "../data/dashboardData";

const kpiIcons = {
  tripsToday: <Route size={18} style={{ color: "#2455D6" }} />,
  inTransit: <Navigation size={18} style={{ color: "#1F4BC6" }} />,
  forApproval: <Clock size={18} style={{ color: "#102F8A" }} />,
  exceptions: <AlertTriangle size={18} style={{ color: "#2455D6" }} />,
};

const kpiIconBgs = {
  tripsToday: "#EEF4FF",
  inTransit: "#E8F0FE",
  forApproval: "#EDF2FF",
  exceptions: "#F0F4FE",
};

export default function DashboardPage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--trackify-bg)" }}>
      <TopNav />

      <main className="max-w-[1400px] mx-auto px-4 pb-10">
        <DashboardHeader dateLabel={dateRange.label} />

        {/* KPI Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
          {kpiCards.map((card) => (
            <KPICard
              key={card.id}
              label={card.label}
              value={card.value}
              change={card.change}
              changeLabel={card.changeLabel}
              color={card.color}
              sparkData={card.sparkData}
              subtitle={card.subtitle}
              icon={kpiIcons[card.id]}
              iconBg={kpiIconBgs[card.id]}
            />
          ))}
        </div>

        {/* Trip Activity + Fleet Availability */}
        <div className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-4 mb-5">
          <TripActivityChart />
          <FleetAvailability />
        </div>

        {/* Active Trips + Top Routes */}
        <div className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-4 mb-5">
          <ActiveTrips />
          <TopRoutes />
        </div>

        {/* Approval Queue + Operational Alerts + Delivery Performance */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
          <ApprovalQueue />
          <OperationalAlerts />
          <DeliveryPerformance />
        </div>

        {/* Last updated */}
        <div className="text-center mt-6">
          <span className="text-[11px]" style={{ color: "var(--trackify-text-secondary)" }}>
            Last updated: {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Auto-refresh every 60 seconds
          </span>
        </div>
      </main>
    </div>
  );
}

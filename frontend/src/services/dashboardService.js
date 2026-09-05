import { getAllTrips } from "./operations/tripService";
import { getAllExceptions } from "./operations/exceptionService";
import { getVehicleStats } from "./fleet/vehicleService";

const STATUS_LABEL = {
  approved: "Approved", assigned: "Assigned", accepted: "Assigned",
  released: "Released", in_transit: "In Transit",
  for_approval: "For Approval", for_validation: "For Validation",
  delivered: "Delivered", operationally_closed: "Closed",
};

const sameDay = (a, b) => a && b && new Date(a).toDateString() === new Date(b).toDateString();

/** counts of `items` falling on each of the last 7 calendar days */
function spark7(items, dateOf) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toDateString();
  });
  return days.map((ds) => items.filter((it) => {
    const v = dateOf(it);
    return v && new Date(v).toDateString() === ds;
  }).length);
}

const dayKey = (v) => (v ? new Date(v).toDateString() : null);

/** last 7 days of real trip movement: departures, arrivals, and late arrivals */
function activity7(trips) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const ds = d.toDateString();
    const arrived = trips.filter((t) => dayKey(t.actualArrival) === ds);
    return {
      date: d.toLocaleDateString([], { weekday: "short" }),
      completed: arrived.length,
      departed: trips.filter((t) => dayKey(t.actualDeparture) === ds).length,
      delayed: arrived.filter(
        (t) => t.scheduledArrival && new Date(t.actualArrival) > new Date(t.scheduledArrival)
      ).length,
    };
  });
}

/** busiest origin -> destination pairs, with their real on-time rate */
function topRoutesFrom(trips) {
  const by = new Map();
  for (const t of trips) {
    if (!t.origin || !t.destination) continue;
    const key = t.origin + " \u2192 " + t.destination;
    if (!by.has(key)) by.set(key, { route: key, trips: 0, closed: 0, onTimeCount: 0 });
    const r = by.get(key);
    r.trips += 1;
    if (t.actualArrival && t.scheduledArrival) {
      r.closed += 1;
      if (new Date(t.actualArrival) <= new Date(t.scheduledArrival)) r.onTimeCount += 1;
    }
  }
  return [...by.values()]
    .sort((a, b) => b.trips - a.trips)
    .slice(0, 5)
    .map((r) => ({
      route: r.route,
      trips: r.trips,
      // null (not 0) when nothing has closed on this route yet, so the panel
      // shows a dash rather than implying a 0% on-time rate
      onTime: r.closed ? Math.round((r.onTimeCount / r.closed) * 100) : null,
    }));
}

export async function getDashboardSummary() {
  const [trips, exceptions, vstats] = await Promise.all([
    getAllTrips({ limit: 3000 }).catch(() => []),
    getAllExceptions().catch(() => []),
    getVehicleStats().catch(() => ({})),
  ]);

  const now = new Date();
  const count = (...s) => trips.filter((t) => s.includes(t.status)).length;
  const openExceptions = exceptions.filter((e) => e.status !== "resolved").length;

  const kpiCards = [
    {
      id: "tripsToday", label: "Trips Today", color: "#2455D6",
      value: trips.filter((t) => sameDay(t.scheduledDeparture, now)).length,
      sparkData: spark7(trips, (t) => t.scheduledDeparture),
      change: 0, changeLabel: "scheduled to depart today",
    },
    {
      id: "inTransit", label: "In Transit", color: "#1F4BC6",
      value: count("in_transit"),
      sparkData: spark7(trips.filter((t) => t.actualDeparture), (t) => t.actualDeparture),
      change: 0, changeLabel: "on the road now",
    },
    {
      id: "forApproval", label: "Awaiting Approval", color: "#102F8A",
      value: count("for_approval", "for_validation"),
      sparkData: spark7(trips, (t) => t.createdAt),
      change: 0, changeLabel: "need validation or approval",
    },
    {
      id: "exceptions", label: "Open Exceptions", color: "#C53030",
      value: openExceptions,
      sparkData: spark7(exceptions, (e) => e.detectedAt),
      change: 0, changeLabel: `${exceptions.length} logged in total`,
    },
  ];

  const fleet = {
    total: vstats.total || 0,
    available: vstats.available || 0,
    onTrip: vstats.onTrip || 0,
    maintenance: vstats.maintenance || 0,
    unavailable: vstats.unavailable || 0,
  };

  const activeTrips = trips
    .filter((t) => ["approved", "assigned", "accepted", "released", "in_transit"].includes(t.status))
    .sort((a, b) => new Date(a.scheduledDeparture || 0) - new Date(b.scheduledDeparture || 0))
    .slice(0, 8)
    .map((t) => ({
      id: t.id,
      ticketNo: t.ticketNo,
      route: `${t.origin} → ${t.destination}`,
      driver: t.driver || "—",
      vehicle: t.vehicle || "—",
      eta: t.scheduledArrival
        ? new Date(t.scheduledArrival).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : "—",
      status: STATUS_LABEL[t.status] || t.status,
    }));

  // trips completed on-time, last 30 days
  const closed = trips.filter((t) => t.status === "operationally_closed" && t.actualArrival && t.scheduledArrival);
  const onTime = closed.filter((t) => new Date(t.actualArrival) <= new Date(t.scheduledArrival)).length;

  return {
    kpiCards,
    fleet,
    activeTrips,
    tripActivity: activity7(trips),
    topRoutes: topRoutesFrom(trips),
    onTimePct: closed.length ? Math.round((onTime / closed.length) * 100) : null,
    completed: count("operationally_closed"),
    lastUpdated: new Date(),
  };
}

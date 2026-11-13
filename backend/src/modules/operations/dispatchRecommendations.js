const LOCATION_FRESH_MS = 24 * 60 * 60 * 1000;
export const SCORING_VERSION = "free-rules-v1";

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const sameText = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const clampScore = (score) => Math.max(0, Math.min(100, Math.round(score)));

export function distanceKm(aLat, aLng, bLat, bLng) {
  const values = [aLat, aLng, bLat, bLng].map(numberOrNull);
  if (values.some((value) => value == null)) return null;
  const [lat1, lng1, lat2, lng2] = values;
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * sinLng ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function branchScore(resource, trip) {
  if (resource.homeBranchId == null) {
    return { points: 15, reason: "No fixed home branch; available to this branch" };
  }
  if (Number(resource.homeBranchId) === Number(trip.branchId)) {
    return { points: 25, reason: `Based in ${resource.homeBranch || "the trip branch"}` };
  }
  return {
    points: 0,
    reason: `Cross-branch from ${resource.homeBranch || `Branch #${resource.homeBranchId}`}; confirmation required`,
  };
}

function proximityScore(driver, trip, now) {
  const at = driver.lastLocationAt ? new Date(driver.lastLocationAt).getTime() : NaN;
  const fresh = Number.isFinite(at) && now - at >= 0 && now - at <= LOCATION_FRESH_MS;
  const km = fresh ? distanceKm(driver.lastLat, driver.lastLng, trip.originLat, trip.originLng) : null;
  if (km == null) {
    return { points: 12, distanceKm: null, reason: "No recent operational location; proximity is neutral" };
  }
  const points = km <= 5 ? 25 : km <= 15 ? 20 : km <= 30 ? 13 : km <= 60 ? 7 : 2;
  return { points, distanceKm: Math.round(km * 10) / 10, reason: `${km.toFixed(1)} km from pickup (last operational location)` };
}

function workloadScore(count) {
  const trips = Math.max(0, Number(count) || 0);
  const points = Math.max(0, 15 - Math.min(5, trips) * 3);
  return { points, reason: `${trips} trip${trips === 1 ? "" : "s"} assigned in the last 30 days` };
}

function rank(list) {
  const sorted = [...list].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return String(a.name || a.plateNo || "").localeCompare(String(b.name || b.plateNo || ""));
  });
  let eligibleRank = 0;
  return sorted.map((item) => ({ ...item, rank: item.eligible ? ++eligibleRank : null }));
}

export function recommendDrivers(trip, drivers, { now = Date.now() } = {}) {
  return rank(drivers.map((driver) => {
    const branch = branchScore(driver, trip);
    const proximity = proximityScore(driver, trip, now);
    const workload = workloadScore(driver.recentTripCount);
    const expiredDocuments = Number(driver.expiredDocumentCount) || 0;
    const eligible = expiredDocuments === 0;
    const reasons = [
      "Active and licence-valid",
      branch.reason,
      proximity.reason,
      workload.reason,
    ];
    if (expiredDocuments) reasons.unshift(`${expiredDocuments} expired compliance document${expiredDocuments === 1 ? "" : "s"}`);
    const score = clampScore(35 + branch.points + proximity.points + workload.points - (expiredDocuments ? 35 : 0));
    return {
      id: Number(driver.id),
      name: driver.name,
      employeeNo: driver.employeeNo || "",
      phone: driver.phone || "",
      licenseNo: driver.licenseNo || "—",
      licenseType: driver.licenseType || "",
      licenseExpiry: driver.licenseExpiry || null,
      homeBranchId: driver.homeBranchId == null ? null : Number(driver.homeBranchId),
      homeBranch: driver.homeBranch || null,
      recentTripCount: Number(driver.recentTripCount) || 0,
      distanceKm: proximity.distanceKm,
      lastLocationAt: driver.lastLocationAt || null,
      status: "active",
      eligible,
      score,
      reasons,
    };
  }));
}

function capacityScore(vehicle, trip) {
  const cargo = numberOrNull(trip.cargoWeight);
  const capacity = numberOrNull(vehicle.capacity);
  if (cargo == null || cargo <= 0) return { points: 18, eligible: true, reason: "No cargo weight entered; capacity is neutral" };
  if (capacity == null || capacity <= 0) return { points: 0, eligible: false, reason: "Vehicle capacity is not recorded" };
  if (capacity < cargo) return { points: 0, eligible: false, reason: `Capacity short by ${Math.ceil(cargo - capacity).toLocaleString()} kg` };
  const utilisation = cargo / capacity;
  const points = utilisation >= 0.65 ? 30 : utilisation >= 0.4 ? 25 : 18;
  return { points, eligible: true, reason: `${cargo.toLocaleString()} of ${capacity.toLocaleString()} kg capacity` };
}

export function recommendVehicles(trip, vehicles) {
  return rank(vehicles.map((vehicle) => {
    const branch = branchScore(vehicle, trip);
    const capacity = capacityScore(vehicle, trip);
    const typeRequired = String(trip.requiredVehicleType || "").trim();
    const typeMatches = !typeRequired || sameText(vehicle.type, typeRequired);
    const blockingMaintenance = Number(vehicle.blockingMaintenanceCount) > 0;
    const expiredDocuments = Number(vehicle.expiredDocumentCount) || 0;
    const insuranceExpired = !!vehicle.insuranceExpired;
    const eligible = capacity.eligible && typeMatches && !blockingMaintenance && !expiredDocuments && !insuranceExpired;
    const reasons = [
      capacity.reason,
      typeRequired ? (typeMatches ? `Matches required ${typeRequired}` : `Requires ${typeRequired}; this is ${vehicle.type}`) : `${vehicle.type || "Vehicle type not recorded"}`,
      branch.reason,
      blockingMaintenance ? "Maintenance is due or in progress" : "No blocking maintenance",
      expiredDocuments ? `${expiredDocuments} expired compliance document${expiredDocuments === 1 ? "" : "s"}` : "Compliance documents clear",
    ];
    if (insuranceExpired) reasons.unshift("Insurance has expired");
    const score = clampScore(
      15 + capacity.points + (typeRequired ? (typeMatches ? 20 : 0) : 10) + branch.points +
      (blockingMaintenance ? 0 : 5) + (expiredDocuments || insuranceExpired ? 0 : 5)
    );
    return {
      id: Number(vehicle.id),
      plateNo: vehicle.plateNo,
      type: vehicle.type || "—",
      capacity: numberOrNull(vehicle.capacity),
      odometer: numberOrNull(vehicle.odometer),
      registrationExpiry: vehicle.registrationExpiry || null,
      insuranceExpiry: vehicle.insuranceExpiry || null,
      homeBranchId: vehicle.homeBranchId == null ? null : Number(vehicle.homeBranchId),
      homeBranch: vehicle.homeBranch || null,
      status: "active",
      eligible,
      score,
      reasons,
    };
  }));
}

export function buildRecommendations({ trip, drivers, vehicles, now = Date.now() }) {
  return {
    version: SCORING_VERSION,
    weights: {
      driver: { readiness: 35, branch: 25, proximity: 25, recentWorkload: 15 },
      vehicle: { readiness: 15, capacity: 30, type: 20, branch: 25, maintenance: 5, compliance: 5 },
    },
    drivers: recommendDrivers(trip, drivers, { now }),
    vehicles: recommendVehicles(trip, vehicles),
  };
}

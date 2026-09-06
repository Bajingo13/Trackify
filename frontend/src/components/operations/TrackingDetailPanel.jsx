import { useState } from "react";
import { Phone, MessageSquare, Eye, MapPin } from "lucide-react";
import TripStatusBadge from "./TripStatusBadge";
import VehicleArt from "../fleet/VehicleArt";
import { fmtDateTime } from "../../services/operations/dispatchService";

const TABS = [
  { id: "shipping", label: "Shipping" },
  { id: "vehicle", label: "Vehicle" },
  { id: "company", label: "Company" },
];

function Row({ label, value }) {
  return (
    <div className="tk-detail-row">
      <span className="tk-detail-label">{label}</span>
      <span className="tk-detail-value">{value ?? "—"}</span>
    </div>
  );
}

/**
 * Right-hand detail panel for a selected trip.
 *
 * Contact actions are real device handoffs (tel:/sms:) using the driver's
 * number from the drivers record — there is no telephony or chat service
 * behind this app, so nothing here pretends to place a call in-product.
 * When a driver has no number on file the actions are disabled and say why.
 */
export default function TrackingDetailPanel({ trip, tracking, driverContact, navigate }) {
  const [tab, setTab] = useState("shipping");

  if (!trip) {
    return (
      <div className="ops-tracking-details">
        <div className="ops-tracking-info-card">
          <div className="ops-tracking-info-title">Trip Details</div>
          <div className="ops-empty" style={{ padding: 32 }}>
            <Eye size={26} style={{ color: "var(--text-3)", marginBottom: 8, opacity: 0.5 }} />
            <div className="ops-empty-desc">Select a trip from the list to view details</div>
          </div>
        </div>
      </div>
    );
  }

  const capacity = trip.vehicleCapacityKg;
  const loaded = trip.cargoWeightKg;
  const ratio = capacity > 0 && loaded != null ? loaded / capacity : null;
  const phone = driverContact?.phone || null;

  return (
    <div className="ops-tracking-details">
      {/* header: ticket, status, driver contact */}
      <div className="ops-tracking-info-card">
        <div className="flex items-start justify-between gap-2" style={{ marginBottom: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div className="tk-detail-ticket">{trip.ticketNo}</div>
            <div className="tk-detail-sub">{trip.origin} → {trip.destination}</div>
          </div>
          <TripStatusBadge status={trip.status} />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <a
            className={`ops-btn ops-btn-secondary tk-contact-btn ${phone ? "" : "is-disabled"}`}
            href={phone ? `tel:${phone}` : undefined}
            aria-disabled={!phone}
            title={phone ? `Call ${trip.driver}` : "No phone number on this driver's record"}
          >
            <Phone size={13} /> Call driver
          </a>
          <a
            className={`ops-btn ops-btn-secondary tk-contact-btn ${phone ? "" : "is-disabled"}`}
            href={phone ? `sms:${phone}` : undefined}
            aria-disabled={!phone}
            title={phone ? `Message ${trip.driver}` : "No phone number on this driver's record"}
          >
            <MessageSquare size={13} /> Message
          </a>
        </div>
      </div>

      {/* capacity hero */}
      <div className="ops-tracking-info-card">
        <div className="ops-tracking-info-title">Current Truck Capacity</div>
        <div className="tk-capacity-hero">
          <VehicleArt
            type={trip.vehicleType}
            height={86}
            load={ratio}
            animated={trip.status === "in_transit" && tracking?.gpsStatus === "online"}
            style={{ width: "100%", maxWidth: 260 }}
          />
        </div>
        <div className="tk-capacity-figure">
          {ratio != null ? `${Math.round(ratio * 100)}%` : "—"}
        </div>
        <div className="tk-detail-sub" style={{ textAlign: "center" }}>
          {capacity > 0 && loaded != null
            ? `${Number(loaded).toLocaleString()} kg of ${Number(capacity).toLocaleString()} kg`
            : capacity > 0
              ? `${Number(capacity).toLocaleString()} kg capacity · no cargo weight recorded`
              : "no capacity recorded for this vehicle"}
        </div>
      </div>

      {/* tabbed detail */}
      <div className="ops-tracking-info-card">
        <div className="tk-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              className={`tk-tab ${tab === t.id ? "is-active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "shipping" && (
          <div className="tk-detail-list">
            <Row label="Origin" value={trip.origin} />
            <Row label="Destination" value={trip.destination} />
            <Row
              label="Current location"
              value={
                tracking?.hasGps ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <MapPin size={12} style={{ color: "var(--text-3)" }} />
                    {tracking.currentLocation}
                  </span>
                ) : "GPS not reporting"
              }
            />
            <Row label="Planned distance" value={trip.routeKm != null ? `${trip.routeKm} km` : null} />
            <Row
              label="Est. drive time"
              value={trip.routeMin != null ? `${Math.floor(trip.routeMin / 60)}h ${Math.round(trip.routeMin % 60)}m` : null}
            />
            <Row label="Planned arrival" value={tracking ? fmtDateTime(tracking.plannedArrival) : null} />
            <Row label="Last GPS update" value={tracking ? fmtDateTime(tracking.lastGpsUpdate) : null} />
          </div>
        )}

        {tab === "vehicle" && (
          <div className="tk-detail-list">
            <Row label="Plate" value={trip.vehicle} />
            <Row label="Type" value={trip.vehicleType} />
            <Row
              label="Capacity"
              value={capacity > 0 ? `${Number(capacity).toLocaleString()} kg` : null}
            />
            <Row
              label="Cargo on board"
              value={loaded != null ? `${Number(loaded).toLocaleString()} kg` : null}
            />
            <Row label="Driver" value={trip.driver} />
            <Row label="Driver contact" value={phone} />
            <Row label="Speed" value={tracking?.speed != null ? `${tracking.speed} km/h` : null} />
            <Row label="Heading" value={tracking?.heading != null ? `${tracking.heading}°` : null} />
          </div>
        )}

        {tab === "company" && (
          <div className="tk-detail-list">
            <Row label="Customer" value={trip.customer !== "—" ? trip.customer : null} />
            <Row label="Trip ticket" value={trip.ticketNo} />
            <Row label="Status" value={<TripStatusBadge status={trip.status} />} />
          </div>
        )}
      </div>

      <button
        className="ops-btn ops-btn-secondary"
        style={{ justifyContent: "center" }}
        onClick={() => navigate(`/operations/trips?trip=${trip.id}`)}
      >
        <Eye size={14} /> View trip details
      </button>
    </div>
  );
}

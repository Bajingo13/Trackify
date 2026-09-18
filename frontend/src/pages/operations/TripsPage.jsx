import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Plus, Search, FileText, ArrowLeft, Layers, Clock, CircleDot, CheckCircle2,
  MapPin, Package, ClipboardList, Route as RouteIcon, History, AlertTriangle, X,
  LayoutGrid, List,
} from "lucide-react";
import TripCard from "../../components/operations/TripCard";
import VehicleCapacity from "../../components/fleet/VehicleCapacity";
import AppShell from "../../components/layout/AppShell";
import {
  Button, Card, PageHeader, StatCard, StatusPill, DataTable, EmptyState,
  Modal, Field, inputStyle, Segmented,
} from "../../components/ui";
import { SkeletonText } from "../../motion/Skeleton";
import { Can, usePermissions } from "../../auth/permissions";
import { useToast } from "../../components/shared/Toast";
import {
  getAllTrips, getTripById, getTripStats, createTrip, updateTrip,
  submitTrip, validateTrip, approveTrip, rejectTrip, releaseTrip, startTrip,
  deliverTrip, closeTrip, cancelTrip, assignTrip, getAssignableResources,
} from "../../services/operations/tripService";
import { searchCustomers } from "../../services/operations/customerService";
import MapView from "../../components/map/MapView";
import LocationPicker from "../../components/map/LocationPicker";
import { searchPlaces } from "../../services/geoService";
import { matchesBarangay, barangayOptions } from "./tripFilters";
import { getDataUrl } from "../../services/apiClient";
import { useRealtime } from "../../services/realtime";

const toSql = (v) => (!v ? null : v.length === 16 ? `${v.replace("T", " ")}:00` : v.replace("T", " "));
/** ISO / SQL datetime -> value for <input type="datetime-local"> (local time) */
const toLocalInput = (v) => {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
/** SQL datetime -> a short, readable stamp for arrival records */
const fmtDateTime = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

const EDITABLE_STATUSES = ["draft", "rejected"];

const WORKFLOW = {
  draft:          [{ k: "submit",   label: "Submit for validation", perm: "trip.submit",  variant: "primary" }],
  for_validation: [{ k: "validate", label: "Validate",              perm: "trip.validate", variant: "primary" },
                   { k: "reject",   label: "Reject",                perm: "trip.reject",  variant: "danger", reason: true }],
  for_approval:   [{ k: "approve",  label: "Approve",               perm: "trip.approve", variant: "primary" },
                   { k: "reject",   label: "Reject",                perm: "trip.reject",  variant: "danger", reason: true }],
  approved:       [{ k: "assign",   label: "Assign driver & vehicle", perm: "trip.assign", variant: "primary" }],
  assigned:       [{ k: "release",  label: "Release for departure", perm: "trip.release", variant: "primary" },
                   { k: "assign",   label: "Reassign",              perm: "trip.assign",  variant: "secondary" }],
  released:       [{ k: "start",    label: "Start transit",         perm: "trip.release", variant: "primary" }],
  in_transit:     [{ k: "deliver",  label: "Confirm delivery",      perm: "trip.close",   variant: "primary", pod: true }],
  delivered:      [{ k: "close",    label: "Close trip",            perm: "trip.close",   variant: "primary" }],
};
const CANCELLABLE = ["draft", "for_validation", "for_approval", "approved", "assigned", "accepted"];
const DISCARDABLE = ["rejected"];
const PRIORITY_FILTERS = [
  { value: "all", label: "All priority" }, { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" }, { value: "normal", label: "Normal" },
];
const ACTION = {
  submit: (id) => submitTrip(id), validate: (id) => validateTrip(id), approve: (id) => approveTrip(id),
  reject: (id, b) => rejectTrip(id, b), release: (id) => releaseTrip(id), start: (id) => startTrip(id),
  deliver: (id, b) => deliverTrip(id, b), close: (id) => closeTrip(id), cancel: (id, b) => cancelTrip(id, b),
};
const ACTION_LABEL = {
  submit: "submit", validate: "validate", approve: "approve", reject: "reject",
  release: "release", start: "start", deliver: "mark delivered", close: "close", cancel: "cancel",
};

const STATUS_FILTERS = [
  { value: "all", label: "All" }, { value: "draft", label: "Draft" },
  { value: "for_approval", label: "For Approval" }, { value: "approved", label: "Approved" },
  { value: "assigned", label: "Assigned" }, { value: "in_transit", label: "In Transit" },
  { value: "delivered", label: "Delivered" }, { value: "operationally_closed", label: "Closed" },
];

/**
 * Proof of delivery, as captured by the driver: who signed, when, where they
 * were standing, and the photo. Only rendered once a delivery is confirmed.
 */
function PodPanel({ trip }) {
  const [photo, setPhoto] = useState(null);
  const [photoErr, setPhotoErr] = useState("");
  const pod = trip.pod;

  useEffect(() => {
    if (!pod?.hasPhoto) return;
    let dead = false;
    getDataUrl(`/operations/trips/${trip.id}/pod-photo`)
      .then((u) => !dead && setPhoto(u))
      .catch((e) => !dead && setPhotoErr(e.message));
    return () => { dead = true; };
  }, [trip.id, pod?.hasPhoto]);

  return (
    <div className="ops-card" style={{ padding: "var(--s-4)" }}>
      <div className="tk-stop-head">Proof of delivery</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,220px)", gap: "var(--s-4)", alignItems: "start" }}>
        <div className="tk-detail-list">
          <div className="tk-detail-row">
            <span className="tk-detail-label">Received by</span>
            <span className="tk-detail-value">{pod.receivedBy}</span>
          </div>
          <div className="tk-detail-row">
            <span className="tk-detail-label">Confirmed</span>
            <span className="tk-detail-value">{fmtDateTime(pod.capturedAt)}</span>
          </div>
          <div className="tk-detail-row">
            <span className="tk-detail-label">By driver</span>
            <span className="tk-detail-value">{pod.driver || "—"}</span>
          </div>
          <div className="tk-detail-row">
            <span className="tk-detail-label">Captured at</span>
            <span className="tk-detail-value">
              {pod.lat != null ? `${pod.lat.toFixed(4)}, ${pod.lng.toFixed(4)}` : "no location"}
            </span>
          </div>
          {pod.note && (
            <div className="tk-detail-row">
              <span className="tk-detail-label">Note</span>
              <span className="tk-detail-value">{pod.note}</span>
            </div>
          )}
        </div>
        <div className="tk-claim-receipt">
          {!pod.hasPhoto ? (
            <div style={{ fontSize: "var(--fs-12)", color: "var(--text-3)", padding: "var(--s-4)", textAlign: "center" }}>
              No photo taken
            </div>
          ) : photoErr ? (
            <div style={{ fontSize: "var(--fs-12)", color: "var(--text-3)", padding: "var(--s-4)" }}>{photoErr}</div>
          ) : !photo ? (
            <div style={{ fontSize: "var(--fs-12)", color: "var(--text-3)", padding: "var(--s-4)" }}>Loading photo…</div>
          ) : (
            <a href={photo} target="_blank" rel="noreferrer" title="Open full size">
              <img src={photo} alt="Proof of delivery" style={{ display: "block", maxWidth: "100%", borderRadius: "var(--r-sm)" }} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TripsPage() {
  const [view, setView] = useState("list");
  const [selected, setSelected] = useState(null);
  const [detailTick, setDetailTick] = useState(0);
  const { addToast } = useToast();
  const { can } = usePermissions();

  const [trips, setTrips] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [barangay, setBarangay] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [flashId, setFlashId] = useState(null);
  const [tripLayout, setTripLayout] = useState(() => {
    try { return localStorage.getItem("tk_trip_layout") || "grid"; } catch { return "grid"; }
  });
  const setTripLayoutPersist = (l) => {
    setTripLayout(l);
    try { localStorage.setItem("tk_trip_layout", l); } catch { /* ignore */ }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, s] = await Promise.all([getAllTrips({ limit: 1000 }), getTripStats()]);
      setTrips(t);
      setStats(s);
    } catch (e) {
      addToast(e.message || "Failed to load trips", "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let r = trips;
    if (status !== "all") r = r.filter((t) => t.status === status);
    if (priority !== "all") r = r.filter((t) => (t.priority || "normal") === priority);
    if (barangay !== "all") r = r.filter((t) => matchesBarangay(t, barangay));
    if (from) r = r.filter((t) => t.scheduledDeparture && new Date(t.scheduledDeparture) >= new Date(from));
    if (to) r = r.filter((t) => t.scheduledDeparture && new Date(t.scheduledDeparture) <= new Date(`${to}T23:59:59`));
    if (q.trim()) {
      const s = q.toLowerCase();
      r = r.filter((t) =>
        [t.ticketNo, t.customer, t.origin, t.destination, t.driver, t.vehicle]
          .filter(Boolean).some((v) => v.toLowerCase().includes(s))
      );
    }
    return r;
  }, [trips, status, priority, barangay, from, to, q]);

  const barangayChoices = useMemo(() => barangayOptions(trips), [trips]);

  const filtersActive = priority !== "all" || barangay !== "all" || from || to;

  const openTrip = (t) => { setSelected(t); setView("detail"); };

  // Deep link from other pages, e.g. Live Tracking's "View Trip Details" ->
  // /operations/trips?trip=123
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("create") === "1") {
      if (can("trip.create")) setView("create");
      setSearchParams((p) => { p.delete("create"); return p; }, { replace: true });
      return;
    }
    const wantId = searchParams.get("trip");
    if (!wantId || !trips.length) return;
    const t = trips.find((x) => String(x.id) === wantId);
    if (t) openTrip(t);
    setSearchParams((p) => { p.delete("trip"); return p; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips, searchParams, setSearchParams, can]);

  return (
    <AppShell pageKey={view === "detail" ? `trip-${selected?.id}` : view}>
      <AnimatePresence mode="wait">
        {view === "list" && (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <PageHeader
              eyebrow="Operations"
              title="Trips"
              subtitle="Every trip ticket and where it is in the workflow"
              actions={
                <Can permission="trip.create">
                  <Button variant="primary" icon={Plus} onClick={() => setView("create")}>New Trip</Button>
                </Can>
              }
            />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "var(--s-3)", marginBottom: "var(--s-5)" }}>
              <StatCard index={0} label="Total" value={stats?.total ?? 0} icon={Layers}
                active={status === "all"} onClick={() => setStatus("all")} />
              <StatCard index={1} label="Pending" value={stats?.pending ?? 0} icon={Clock} />
              <StatCard index={2} label="In Transit" value={stats?.inTransit ?? 0} icon={CircleDot}
                active={status === "in_transit"} onClick={() => setStatus(status === "in_transit" ? "all" : "in_transit")} />
              <StatCard index={3} label="Delivered" value={stats?.delivered ?? 0} icon={CheckCircle2}
                active={status === "delivered"} onClick={() => setStatus(status === "delivered" ? "all" : "delivered")} />
            </div>

            <div style={{ display: "flex", gap: "var(--s-3)", marginBottom: "var(--s-4)", flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 11px", background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: "var(--r-sm)", flex: "1 1 240px", maxWidth: 320 }}>
                <Search size={14} style={{ color: "var(--text-3)" }} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search trips…" style={{ border: "none", outline: "none", background: "transparent", fontSize: "var(--fs-13)", color: "var(--text)", width: "100%" }} />
              </div>
              <Segmented options={STATUS_FILTERS} value={status} onChange={setStatus} />
            </div>

            <div style={{ display: "flex", gap: "var(--s-3)", marginBottom: "var(--s-4)", flexWrap: "wrap", alignItems: "center" }}>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}
                style={{ padding: "7px 10px", border: "1px solid var(--line-strong)", borderRadius: "var(--r-sm)", background: "var(--surface)", fontSize: "var(--fs-13)", color: "var(--text)" }}>
                {PRIORITY_FILTERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              {barangayChoices.length > 0 && (
                <select value={barangay} onChange={(e) => setBarangay(e.target.value)}
                  aria-label="Filter by barangay"
                  style={{ padding: "7px 10px", border: "1px solid var(--line-strong)", borderRadius: "var(--r-sm)", background: "var(--surface)", fontSize: "var(--fs-13)", color: "var(--text)" }}>
                  <option value="all">All barangays</option>
                  {barangayChoices.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
                Departure
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                  style={{ padding: "6px 8px", border: "1px solid var(--line-strong)", borderRadius: "var(--r-sm)", background: "var(--surface)", fontSize: "var(--fs-12)", color: "var(--text)" }} />
                <span>–</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                  style={{ padding: "6px 8px", border: "1px solid var(--line-strong)", borderRadius: "var(--r-sm)", background: "var(--surface)", fontSize: "var(--fs-12)", color: "var(--text)" }} />
              </label>
              {filtersActive && (
                <Button variant="ghost" size="sm" onClick={() => { setPriority("all"); setBarangay("all"); setFrom(""); setTo(""); }}>Clear filters</Button>
              )}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--s-3)" }}>
                <span style={{ fontSize: "var(--fs-12)", color: "var(--text-3)" }}>{filtered.length} of {trips.length}</span>
                <div style={{ display: "inline-flex", gap: 2, padding: 3, background: "var(--surface-sunk)", borderRadius: "var(--r-sm)", border: "1px solid var(--line)" }}>
                  {[["grid", LayoutGrid, "Card view"], ["table", List, "Table view"]].map(([k, Icon, label]) => (
                    <button
                      key={k} title={label} aria-label={label} aria-pressed={tripLayout === k}
                      onClick={() => setTripLayoutPersist(k)}
                      style={{
                        display: "inline-flex", alignItems: "center", padding: "5px 9px", border: "none", cursor: "pointer", borderRadius: "var(--r-xs)",
                        background: tripLayout === k ? "var(--surface)" : "transparent",
                        color: tripLayout === k ? "var(--accent)" : "var(--text-2)",
                        boxShadow: tripLayout === k ? "var(--shadow-1)" : "none",
                      }}
                    >
                      <Icon size={14} />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {tripLayout === "grid" ? (
              filtered.length === 0 ? (
                <EmptyState icon={FileText} title="No trips match" hint="Adjust the filter or search." />
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: "var(--s-4)" }}>
                  {filtered.map((t) => (
                    <TripCard key={t.id} trip={t} selected={flashId === t.id} onClick={() => openTrip(t)} />
                  ))}
                </div>
              )
            ) : (
            <DataTable
              loading={loading}
              rowKey={(r) => r.id}
              onRowClick={openTrip}
              flashKey={flashId}
              empty={{ icon: FileText, title: "No trips match", hint: "Adjust the filter or search." }}
              columns={[
                { key: "ticketNo", header: "Trip", grow: true, render: (r) => (
                  <span style={{ display: "flex", flexDirection: "column" }}>
                    <span className="tk-mono" style={{ fontWeight: 600, color: "var(--text)" }}>{r.ticketNo}</span>
                    <span style={{ fontSize: "var(--fs-12)", color: "var(--text-3)" }}>{r.customer}</span>
                  </span>
                ) },
                { key: "route", header: "Route", render: (r) => `${r.origin} → ${r.destination}` },
                { key: "driver", header: "Driver", render: (r) => r.driver || "—" },
                { key: "vehicle", header: "Vehicle", render: (r) => r.vehicle || "—" },
                { key: "departure", header: "Departure", render: (r) => r.scheduledDeparture ? new Date(r.scheduledDeparture).toLocaleDateString() : "—" },
                { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} size="sm" /> },
              ]}
              rows={filtered}
            />
            )}
          </motion.div>
        )}

        {view === "detail" && selected && (
          <TripDetail
            key={`detail-${selected.id}-${detailTick}`}
            initial={selected}
            onBack={() => setView("list")}
            onEdit={(full) => { if (full) setSelected(full); setView("edit"); }}
            onChanged={(id) => { setFlashId(id); load(); }}
          />
        )}

        {view === "create" && (
          <TripForm key="create" onBack={() => setView("list")} onSaved={() => { load(); setView("list"); }} />
        )}

        {view === "edit" && selected && (
          <TripForm
            key={`edit-${selected.id}`}
            editTrip={selected}
            onBack={() => setView("detail")}
            onSaved={() => { load(); setDetailTick((t) => t + 1); setView("detail"); }}
          />
        )}
      </AnimatePresence>
    </AppShell>
  );
}

/* ============ detail ============ */
function TripDetail({ initial, onBack, onChanged, onEdit }) {
  const { addToast } = useToast();
  const { can } = usePermissions();
  const [trip, setTrip] = useState(initial);
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState(null);
  const [modal, setModal] = useState(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [actionError, setActionError] = useState(null);

  const refresh = useCallback(async () => {
    setDetailLoading(true);
    try { setTrip(await getTripById(initial.id)); } catch { /* keep */ }
    finally { setDetailLoading(false); }
  }, [initial.id]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { setActionError(null); }, [trip.status]);

  // The driver acting on their phone — starting the run, reaching a stop,
  // confirming delivery — publishes an event. Without this the dispatcher is
  // looking at a snapshot and has to know to press refresh.
  useRealtime(
    useCallback(
      (msg) => {
        if ((msg?.type === "trip:status" || msg?.type === "trip:stop") && msg.tripId === initial.id) {
          refresh();
        }
      },
      [initial.id, refresh]
    )
  );

  async function run(action, body) {
    setBusy(action);
    setActionError(null);
    try {
      const res = await ACTION[action](trip.id, body);
      addToast(res?.message || "Done", "success");
      setModal(null);
      await refresh();
      onChanged?.(trip.id);
    } catch (e) {
      const reasons = Array.isArray(e?.data?.errors) ? e.data.errors : [];
      const label = ACTION_LABEL[action] || action;
      addToast(e.message || `Could not ${label} this trip`, "error");
      setActionError({
        title: e.message || `Could not ${label} this trip`,
        status: e.status,
        reasons,
      });
    } finally {
      setBusy(null);
    }
  }

  const steps = WORKFLOW[trip.status] || [];
  const visible = steps.filter((s) => can(s.perm));
  const canCancel = CANCELLABLE.includes(trip.status) && can("trip.cancel");
  const canDiscard = DISCARDABLE.includes(trip.status) && can("trip.cancel");
  const hint = steps.length && !visible.length
    ? `This trip is ${trip.status.replace(/_/g, " ")} — the next step (${steps.map((s) => s.label).join(" / ")}) belongs to another role.`
    : !steps.length ? `This trip is ${trip.status.replace(/_/g, " ")}. No workflow action at this stage.` : null;

  const TABS = [
    { k: "overview", label: "Overview", icon: ClipboardList },
    { k: "route", label: "Route", icon: RouteIcon },
    { k: "cargo", label: "Cargo", icon: Package },
    { k: "assignment", label: "Assignment", icon: MapPin },
    { k: "timeline", label: "Timeline", icon: History },
  ];

  return (
    <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--s-3)", marginBottom: "var(--s-4)" }}>
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>Back</Button>
        <div>
          <h1 className="tk-mono" style={{ margin: 0, fontSize: "var(--fs-18)", fontWeight: 700, color: "var(--text)" }}>{trip.ticketNo}</h1>
          <span style={{ fontSize: "var(--fs-12)", color: "var(--text-3)" }}>{trip.customer}</span>
        </div>
        <div style={{ marginLeft: "auto" }}><StatusPill status={trip.status} /></div>
      </div>

      <Card pad="var(--s-3)" style={{ marginBottom: "var(--s-4)", display: "flex", gap: "var(--s-2)", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "var(--fs-12)", fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".05em", marginRight: 4 }}>Actions</span>
        {EDITABLE_STATUSES.includes(trip.status) && (can("trip.update") || can("trip.create")) && (
          <Button variant="secondary" size="sm" icon={FileText} disabled={busy !== null} onClick={() => onEdit?.(trip)}>
            Edit trip
          </Button>
        )}
        {hint && <span style={{ fontSize: "var(--fs-12)", color: "var(--text-2)" }}>{hint}</span>}
        {visible.map((s) => (
          <Button
            key={s.k + s.label}
            variant={s.variant}
            size="sm"
            loading={busy === s.k}
            disabled={busy !== null}
            onClick={() => {
              if (s.k === "assign") setModal({ t: "assign" });
              else if (s.reason) setModal({ t: "reason", action: s.k });
              else if (s.pod) setModal({ t: "pod" });
              else run(s.k);
            }}
          >
            {s.label}
          </Button>
        ))}
        {canCancel && (
          <Button variant="danger" size="sm" style={{ marginLeft: "auto" }} disabled={busy !== null} onClick={() => setModal({ t: "reason", action: "cancel" })}>
            Cancel trip
          </Button>
        )}
        {canDiscard && (
          <Button variant="danger" size="sm" style={{ marginLeft: "auto" }} disabled={busy !== null} onClick={() => setModal({ t: "reason", action: "cancel" })}>
            Discard trip
          </Button>
        )}

        {actionError && (
          <div style={{
            width: "100%", marginTop: 4, padding: "10px 12px", borderRadius: "var(--r-sm)",
            background: "var(--danger-soft)", border: "1px solid var(--danger-line)",
            display: "flex", gap: 8, alignItems: "flex-start",
          }}>
            <AlertTriangle size={15} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 1 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--danger)" }}>{actionError.title}</div>
              {actionError.reasons.length > 0 ? (
                <ul style={{ margin: "5px 0 0", paddingLeft: 16, fontSize: "var(--fs-12)", color: "var(--text-2)" }}>
                  {actionError.reasons.map((r, i) => <li key={i} style={{ marginTop: 2 }}>{r}</li>)}
                </ul>
              ) : (
                <div style={{ marginTop: 4, fontSize: "var(--fs-12)", color: "var(--text-2)" }}>
                  {actionError.status === 403
                    ? "Your role doesn't permit this action in the current scope."
                    : actionError.status === 409
                      ? "The trip isn't in the right state for this step — refresh and check its status."
                      : "Fix the issue and try again, or check the trip's details."}
                </div>
              )}
            </div>
            <button onClick={() => setActionError(null)} style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer", color: "var(--text-3)", padding: 2, flexShrink: 0 }} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}
      </Card>

      <Card pad="0">
        <div style={{ display: "flex", gap: 2, padding: "6px 8px", borderBottom: "1px solid var(--line)", overflowX: "auto" }}>
          {TABS.map((t) => {
            const active = tab === t.k;
            return (
              <button key={t.k} onClick={() => setTab(t.k)} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", border: "none", background: "transparent", cursor: "pointer", fontSize: "var(--fs-13)", fontWeight: 600, color: active ? "var(--accent)" : "var(--text-2)", borderRadius: "var(--r-xs)" }}>
                <t.icon size={13} /> {t.label}
                {active && <motion.span layoutId="trip-tab" transition={{ type: "spring", stiffness: 500, damping: 34 }} style={{ position: "absolute", left: 8, right: 8, bottom: -7, height: 2, background: "var(--accent)", borderRadius: 2 }} />}
              </button>
            );
          })}
        </div>
        <div style={{ padding: "var(--s-5)" }}>
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
              {tab === "overview" && (
                <DetailGrid rows={[
                  ["Ticket No", trip.ticketNo], ["Customer", trip.customer], ["Purpose", trip.purpose],
                  ["Scheduled departure", fmt(trip.scheduledDeparture)], ["Scheduled arrival", fmt(trip.scheduledArrival)],
                  ["Actual departure", fmt(trip.actualDeparture)], ["Actual arrival", fmt(trip.actualArrival)],
                  ["Priority", trip.priority], ["Approved by", trip.approvedBy || "—"],
                ]} />
              )}
              {tab === "route" && <RouteTab trip={trip} />}
              {tab === "cargo" && <DetailGrid rows={[
                ["Description", trip.cargoDescription || "—"], ["Quantity", trip.cargoQuantity ?? "—"],
                ["Weight", trip.cargoWeight != null ? `${trip.cargoWeight} kg` : "—"], ["Special handling", trip.specialHandling || "—"],
                ["Dispatch notes", trip.dispatchNotes || "—"], ["Instructions", trip.specialInstructions || "—"],
              ]} />}
              {tab === "assignment" && (
                <div style={{ display: "grid", gap: "var(--s-4)" }}>
                  <DetailGrid rows={[["Driver", trip.driver || "Not assigned"], ["Vehicle", trip.vehicle || "Not assigned"]]} />
                  {trip.vehicle && (
                    <VehicleCapacity
                      vehicle={{ plateNo: trip.vehicle, type: trip.vehicleType, capacityKg: trip.vehicleCapacityKg }}
                      loadKg={trip.cargoWeight}
                    />
                  )}
                </div>
              )}
              {tab === "timeline" && (
                detailLoading ? <SkeletonText lines={5} /> : (
                  <div style={{ display: "grid", gap: "var(--s-4)" }}>
                    {trip.pod && <PodPanel trip={trip} />}
                    <Timeline events={trip.history || []} />
                  </div>
                )
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </Card>

      <Modal open={modal?.t === "reason"} onClose={() => setModal(null)}
        title={modal?.action === "cancel" ? "Cancel trip" : "Reject trip"} footer={null}>
        <ReasonForm
          prompt={modal?.action === "cancel" ? "Why is this trip being cancelled?" : "Why is this trip being rejected?"}
          busy={busy !== null}
          onCancel={() => setModal(null)}
          onSubmit={(txt) => run(modal.action, { reason: txt })}
        />
      </Modal>

      <Modal open={modal?.t === "pod"} onClose={() => setModal(null)} title="Confirm delivery" footer={null}>
        <PodForm busy={busy !== null} onCancel={() => setModal(null)} onSubmit={(b) => run("deliver", b)} />
      </Modal>

      <Modal open={modal?.t === "assign"} onClose={() => setModal(null)} title="Assign driver & vehicle" width={480} footer={null}>
        <AssignForm busy={busy === "assign"} onCancel={() => setModal(null)} onSubmit={async (b, onCrossBranch) => {
          setBusy("assign");
          try {
            const res = await assignTrip(trip.id, b);
            addToast(res?.message || "Assigned", "success"); setModal(null); await refresh(); onChanged?.(trip.id);
          } catch (e) {
            if (e?.data?.code === "CROSS_BRANCH") {
              // warn-but-allow: keep the modal open, let the user confirm in place
              onCrossBranch?.(e.data.message || e.message);
            } else {
              addToast(e.message || "Assign failed", "error");
            }
          } finally { setBusy(null); }
        }} />
      </Modal>
    </motion.div>
  );
}

function ReasonForm({ prompt, busy, onCancel, onSubmit }) {
  const [txt, setTxt] = useState("");
  return (
    <div style={{ display: "grid", gap: "var(--s-3)" }}>
      <p style={{ margin: 0, fontSize: "var(--fs-13)", color: "var(--text-2)" }}>{prompt}</p>
      <textarea autoFocus value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Reason…"
        style={{ ...inputStyle, minHeight: 88, resize: "vertical" }} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--s-2)", marginTop: 4 }}>
        <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="danger-solid" size="sm" loading={busy} disabled={!txt.trim()} onClick={() => onSubmit(txt.trim())}>Confirm</Button>
      </div>
    </div>
  );
}

function PodForm({ busy, onCancel, onSubmit }) {
  const [receivedBy, setReceivedBy] = useState("");
  const [remarks, setRemarks] = useState("");
  return (
    <div style={{ display: "grid", gap: "var(--s-3)" }}>
      <Field label="Received by" required><input style={inputStyle} autoFocus value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Name of consignee" /></Field>
      <Field label="Remarks"><textarea style={{ ...inputStyle, minHeight: 64, resize: "vertical" }} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--s-2)", marginTop: 4 }}>
        <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" loading={busy} disabled={!receivedBy.trim()} onClick={() => onSubmit({ receivedBy: receivedBy.trim(), remarks: remarks.trim() })}>Confirm delivery</Button>
      </div>
    </div>
  );
}

function AssignForm({ busy, onCancel, onSubmit }) {
  const [res, setRes] = useState(null);
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [crossWarn, setCrossWarn] = useState("");
  // a new pick is a new decision — drop any prior cross-branch warning
  useEffect(() => { setCrossWarn(""); }, [driverId, vehicleId]);
  useEffect(() => { getAssignableResources().then(setRes).catch(() => setRes({ drivers: [], vehicles: [] })); }, []);
  if (!res) return <SkeletonText lines={3} />;

  const submit = (allowCrossBranch) =>
    onSubmit(
      { driverId: Number(driverId), vehicleId: Number(vehicleId), ...(allowCrossBranch ? { allowCrossBranch: true } : {}) },
      (msg) => setCrossWarn(msg),
    );

  return (
    <div style={{ display: "grid", gap: "var(--s-3)" }}>
      <Field label="Driver" required>
        <select style={inputStyle} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">— available drivers —</option>
          {res.drivers.map((d) => <option key={d.id} value={d.id}>{d.label} · {d.sub}</option>)}
        </select>
      </Field>
      <Field label="Vehicle" required>
        <select style={inputStyle} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="">— available vehicles —</option>
          {res.vehicles.map((v) => <option key={v.id} value={v.id}>{v.label} · {v.sub}</option>)}
        </select>
      </Field>
      {(!res.drivers.length || !res.vehicles.length) && (
        <p style={{ fontSize: "var(--fs-12)", color: "var(--warn)" }}>No available {!res.drivers.length ? "drivers" : "vehicles"} right now.</p>
      )}
      {crossWarn && (
        <div style={{ padding: "10px 12px", borderRadius: "var(--r-2)", background: "var(--warn-bg, #FFFBEB)", border: "1px solid var(--warn)", fontSize: "var(--fs-12)", color: "var(--warn)" }}>
          <strong>Different branch.</strong> {crossWarn}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--s-2)", marginTop: 4 }}>
        <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant={crossWarn ? "danger-solid" : "primary"} size="sm" loading={busy} disabled={!driverId || !vehicleId} onClick={() => submit(Boolean(crossWarn))}>
          {crossWarn ? "Assign anyway" : "Assign"}
        </Button>
      </div>
    </div>
  );
}

function RouteTab({ trip }) {
  const oc = trip.originCoord, dc = trip.destCoord;
  const stops = (trip.stops || []).filter((s) => s.lat != null);
  const mins = trip.routeMin;
  const eta = mins == null ? null : mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return (
    <div style={{ display: "grid", gap: "var(--s-4)" }}>
      <DetailGrid rows={[
        ["Origin", trip.origin],
        ["Destination", trip.destination],
        ["Stops", stops.length
          ? `${stops.filter((s) => s.arrivedAt).length} of ${stops.length} reached`
          : (trip.intermediateStops || []).join(", ") || "—"],
        ["Planned distance", trip.routeKm != null ? `${trip.routeKm} km` : "—"],
        ["Est. drive time", eta || "—"],
      ]} />
      {stops.length > 0 && (
        <div className="ops-card" style={{ padding: "var(--s-4)" }}>
          <div className="tk-stop-head">Stop progress</div>
          <ol className="tk-stops">
            {stops.map((st, i) => (
              <li key={st.id ?? i} className="tk-stop" data-done={st.arrivedAt ? "yes" : "no"}>
                <span className="tk-stop-dot" aria-hidden="true" />
                <div style={{ minWidth: 0 }}>
                  <div className="tk-stop-label">
                    {i + 1}. {st.label}
                  </div>
                  <div className="tk-stop-meta">
                    {st.arrivedAt
                      ? `Reached ${fmtDateTime(st.arrivedAt)}${st.arrivedLat != null ? ` · ${Number(st.arrivedLat).toFixed(4)}, ${Number(st.arrivedLng).toFixed(4)}` : ""}`
                      : st.plannedArrival
                        ? `Due ${fmtDateTime(st.plannedArrival)} · not yet reached`
                        : "Not yet reached"}
                  </div>
                  {st.arrivalNote && <div className="tk-stop-note">{st.arrivalNote}</div>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {oc && dc ? (
        <div style={{ height: 300, borderRadius: "var(--r-2)", overflow: "hidden", border: "1px solid var(--line)" }}>
          <MapView
            center={[oc.lng, oc.lat]}
            zoom={8}
            markers={[
              { id: "o", lng: oc.lng, lat: oc.lat, color: "#16a34a", popupHtml: `<b>Origin</b><span>${trip.origin}</span>` },
              ...stops.map((s, i) => ({
                id: `s${i}`,
                lng: s.lng,
                lat: s.lat,
                color: s.arrivedAt ? "#158a4a" : "#93a1bd",
                popupHtml: `<b>Stop ${i + 1}</b><span>${s.label}${s.arrivedAt ? " — reached" : ""}</span>`,
              })),
              { id: "d", lng: dc.lng, lat: dc.lat, color: "#dc2626", popupHtml: `<b>Destination</b><span>${trip.destination}</span>` },
            ]}
            routes={trip.routeGeom ? [{ id: "planned", geometry: trip.routeGeom, color: "#2455D6", width: 4 }] : []}
            fitTo={[[oc.lng, oc.lat], ...stops.map((s) => [s.lng, s.lat]), [dc.lng, dc.lat]]}
            height="100%"
          />
        </div>
      ) : (
        <p style={{ fontSize: "var(--fs-12)", color: "var(--text-3)" }}>
          No coordinates on this trip — edit it and use “Set on map” to enable the route map and live tracking.
        </p>
      )}
    </div>
  );
}

function DetailGrid({ rows }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--s-4) var(--s-6)" }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: "var(--fs-11)", fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".04em" }}>{k}</span>
          <span style={{ fontSize: "var(--fs-13)", color: "var(--text)" }}>{v ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}

function Timeline({ events }) {
  if (!events.length) return <EmptyState icon={History} title="No activity yet" />;
  return (
    <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }} style={{ display: "flex", flexDirection: "column" }}>
      {events.map((e, i) => (
        <motion.div key={i} variants={{ hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0 } }} style={{ display: "flex", gap: 12, paddingBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--accent)", marginTop: 4, flexShrink: 0 }} />
            {i < events.length - 1 && <span style={{ flex: 1, width: 2, background: "var(--line)", marginTop: 4 }} />}
          </div>
          <div>
            <div className="tk-mono" style={{ fontSize: "var(--fs-12)", fontWeight: 600, color: "var(--text)" }}>{e.action}</div>
            <div style={{ fontSize: "var(--fs-13)", color: "var(--text-2)" }}>{e.details}</div>
            <div style={{ fontSize: "var(--fs-11)", color: "var(--text-3)", marginTop: 2 }}>{fmt(e.timestamp)} · {e.user}</div>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}

const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");

/* ============ create / edit ============ */
function TripForm({ onBack, onSaved, editTrip = null }) {
  const { addToast } = useToast();
  const isEdit = !!editTrip;
  const [customers, setCustomers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [picker, setPicker] = useState(false);
  const [f, setF] = useState(() => ({
    customer: editTrip?.customerId ? String(editTrip.customerId) : "",
    purpose: editTrip?.purpose || "",
    origin: editTrip?.origin || "",
    destination: editTrip?.destination || "",
    originLat: editTrip?.originCoord?.lat ?? null,
    originLng: editTrip?.originCoord?.lng ?? null,
    destinationLat: editTrip?.destCoord?.lat ?? null,
    destinationLng: editTrip?.destCoord?.lng ?? null,
    // The street and barangay behind each pin. Nothing is typed into these —
    // the picker returns them with every search hit and every dropped pin.
    originAddress: editTrip?.originAddress || null,
    destinationAddress: editTrip?.destAddress || null,
    routeKm: editTrip?.routeKm ?? null,
    routeMin: editTrip?.routeMin ?? null,
    stops: Array.isArray(editTrip?.stops) ? editTrip.stops.filter((s) => s.lat != null) : [],
    priority: editTrip?.priority || "normal",
    scheduledDeparture: toLocalInput(editTrip?.scheduledDeparture),
    scheduledArrival: toLocalInput(editTrip?.scheduledArrival),
    cargoDescription: editTrip?.cargoDescription || "",
    cargoQuantity: editTrip?.cargoQuantity ?? "",
    cargoWeight: editTrip?.cargoWeight ?? "",
    specialHandling: editTrip?.specialHandling || "",
    dispatchNotes: editTrip?.dispatchNotes || "",
    specialInstructions: editTrip?.specialInstructions || "",
  }));
  const on = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  useEffect(() => { searchCustomers("").then(setCustomers).catch(() => setCustomers([])); }, []);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErr(null);

    // A trip saved without coordinates can never be routed, so distance and
    // ETA stay blank on it forever. If the map picker was not used, resolve
    // the typed place names through the same geocoder the picker uses. It is
    // best-effort: if a name cannot be resolved the trip still saves, just
    // without a route, exactly as before.
    let oLat = f.originLat, oLng = f.originLng;
    let dLat = f.destinationLat, dLng = f.destinationLng;
    let oAddr = f.originAddress, dAddr = f.destinationAddress;
    if (oLat == null && f.origin?.trim()) {
      const hit = (await searchPlaces(f.origin).catch(() => []))[0];
      if (hit) { oLat = hit.lat; oLng = hit.lng; oAddr = oAddr || hit.address || null; }
    }
    if (dLat == null && f.destination?.trim()) {
      const hit = (await searchPlaces(f.destination).catch(() => []))[0];
      if (hit) { dLat = hit.lat; dLng = hit.lng; dAddr = dAddr || hit.address || null; }
    }

    const payload = {
      customerId: f.customer ? Number(f.customer) : null,
      purpose: f.purpose, origin: f.origin, destination: f.destination,
      priority: f.priority || "normal",
      originLat: oLat, originLng: oLng,
      destinationLat: dLat, destinationLng: dLng,
      originAddress: oAddr, destinationAddress: dAddr,
      stops: f.stops.map((s, i) => ({
        stopType: "waypoint", locationName: s.label, latitude: s.lat, longitude: s.lng,
      })),
      scheduledDeparture: toSql(f.scheduledDeparture), scheduledArrival: toSql(f.scheduledArrival),
      cargoDescription: f.cargoDescription || null,
      cargoQuantity: f.cargoQuantity ? Number(f.cargoQuantity) : null,
      cargoWeight: f.cargoWeight ? Number(f.cargoWeight) : null,
      specialHandling: f.specialHandling || null, dispatchNotes: f.dispatchNotes || null,
      specialInstructions: f.specialInstructions || null,
    };
    try {
      if (isEdit) {
        await updateTrip(editTrip.id, payload);
        addToast("Trip updated", "success");
      } else {
        const res = await createTrip(payload);
        addToast(`Trip ${res?.data?.ticketNo || "draft"} created`, "success");
      }
      onSaved();
    } catch (e2) {
      const reasons = Array.isArray(e2?.data?.errors) ? e2.data.errors : [];
      setErr({ title: e2.message || `Failed to ${isEdit ? "update" : "create"} trip`, reasons });
      addToast(e2.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--s-3)", marginBottom: "var(--s-4)" }}>
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>Back</Button>
        <h1 style={{ margin: 0, fontSize: "var(--fs-18)", fontWeight: 700, color: "var(--text)" }}>
          {isEdit ? `Edit trip ${editTrip.ticketNo}` : "Create trip"}
        </h1>
      </div>
      {err && (
        <Card style={{ marginBottom: "var(--s-4)", background: "var(--danger-soft)", borderColor: "var(--danger-line)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <AlertTriangle size={15} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 1 }} />
            <div>
              <div style={{ fontSize: "var(--fs-13)", fontWeight: 600, color: "var(--danger)" }}>{err.title}</div>
              {err.reasons.length > 0 && (
                <ul style={{ margin: "5px 0 0", paddingLeft: 16, fontSize: "var(--fs-12)", color: "var(--text-2)" }}>
                  {err.reasons.map((r, i) => <li key={i} style={{ marginTop: 2 }}>{r}</li>)}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}
      <form onSubmit={submit}>
        <Card style={{ marginBottom: "var(--s-4)" }}>
          <h3 style={{ margin: "0 0 var(--s-4)", fontSize: "var(--fs-14)", fontWeight: 700 }}>Trip information</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s-4)" }}>
            <Field label="Customer">
              <select style={inputStyle} value={f.customer} onChange={on("customer")}>
                <option value="">— select customer —</option>
                {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.customer_name}</option>)}
              </select>
            </Field>
            <Field label="Purpose" required><input style={inputStyle} value={f.purpose} onChange={on("purpose")} required placeholder="e.g. Goods Delivery" /></Field>
            <Field label="Origin" required><input style={inputStyle} value={f.origin} onChange={on("origin")} required /></Field>
            <Field label="Destination" required><input style={inputStyle} value={f.destination} onChange={on("destination")} required /></Field>
            <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: "var(--s-3)", flexWrap: "wrap" }}>
              <Button variant="secondary" size="sm" type="button" icon={MapPin} onClick={() => setPicker(true)}>
                {f.originLat != null && f.destinationLat != null ? "Edit route on map" : "Set on map"}
              </Button>
              <span style={{ fontSize: "var(--fs-12)", color: "var(--text-2)" }}>
                {f.originLat != null && f.destinationLat != null
                  ? `Coordinates set${f.routeKm != null ? ` · ${f.routeKm} km, ~${Math.round(f.routeMin)} min` : ""}${f.stops.length ? ` · ${f.stops.length} stop${f.stops.length > 1 ? "s" : ""}` : ""}`
                  : "Optional, but needed for live tracking, distance and the map."}
              </span>
            </div>
            {f.stops.length > 0 && (
              <div style={{ gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", gap: 6 }}>
                {f.stops.map((s, i) => (
                  <span key={i} style={{ fontSize: "var(--fs-12)", background: "var(--warn-soft)", color: "var(--warn)", border: "1px solid var(--warn-line)", borderRadius: 999, padding: "2px 10px" }}>
                    {i + 1}. {s.label?.split(",")[0] || `${s.lat.toFixed(3)}, ${s.lng.toFixed(3)}`}
                  </span>
                ))}
              </div>
            )}
            {f.originLat != null && f.destinationLat != null && (
              <div style={{ gridColumn: "1 / -1", height: 200, borderRadius: "var(--r-2)", overflow: "hidden", border: "1px solid var(--line)" }}>
                <MapView
                  center={[f.originLng, f.originLat]}
                  zoom={8}
                  markers={[
                    { id: "o", lng: f.originLng, lat: f.originLat, color: "#16a34a" },
                    ...f.stops.map((s, i) => ({ id: `s${i}`, lng: s.lng, lat: s.lat, color: "#d97706" })),
                    { id: "d", lng: f.destinationLng, lat: f.destinationLat, color: "#dc2626" },
                  ]}
                  fitTo={[[f.originLng, f.originLat], ...f.stops.map((s) => [s.lng, s.lat]), [f.destinationLng, f.destinationLat]]}
                  height="100%"
                />
              </div>
            )}
            <Field label="Priority">
              <select style={inputStyle} value={f.priority} onChange={on("priority")}>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </Field>
            <Field label="Scheduled departure" required><input type="datetime-local" style={inputStyle} value={f.scheduledDeparture} onChange={on("scheduledDeparture")} required /></Field>
            <Field label="Scheduled arrival"><input type="datetime-local" style={inputStyle} value={f.scheduledArrival} onChange={on("scheduledArrival")} /></Field>
          </div>
        </Card>
        <Card style={{ marginBottom: "var(--s-4)" }}>
          <h3 style={{ margin: "0 0 var(--s-4)", fontSize: "var(--fs-14)", fontWeight: 700 }}>Cargo</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s-4)" }}>
            <Field label="Description"><input style={inputStyle} value={f.cargoDescription} onChange={on("cargoDescription")} /></Field>
            <Field label="Special handling"><input style={inputStyle} value={f.specialHandling} onChange={on("specialHandling")} placeholder="Fragile, Refrigerated…" /></Field>
            <Field label="Quantity"><input type="number" style={inputStyle} value={f.cargoQuantity} onChange={on("cargoQuantity")} /></Field>
            <Field label="Weight (kg)"><input type="number" style={inputStyle} value={f.cargoWeight} onChange={on("cargoWeight")} /></Field>
            <Field label="Dispatch notes"><textarea style={{ ...inputStyle, minHeight: 56, resize: "vertical" }} value={f.dispatchNotes} onChange={on("dispatchNotes")} /></Field>
            <Field label="Special instructions"><textarea style={{ ...inputStyle, minHeight: 56, resize: "vertical" }} value={f.specialInstructions} onChange={on("specialInstructions")} /></Field>
          </div>
        </Card>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--s-2)" }}>
          <Button variant="secondary" onClick={onBack} type="button">Cancel</Button>
          <Button variant="primary" type="submit" loading={saving}>{isEdit ? "Save changes" : "Save draft"}</Button>
        </div>
      </form>

      {picker && (
        <LocationPicker
          value={{
            origin: f.originLat != null ? { lat: f.originLat, lng: f.originLng, label: f.origin } : null,
            destination: f.destinationLat != null ? { lat: f.destinationLat, lng: f.destinationLng, label: f.destination } : null,
            stops: f.stops,
          }}
          onClose={() => setPicker(false)}
          onDone={(val, route) => {
            setF((p) => ({
              ...p,
              origin: val.origin?.label || p.origin,
              destination: val.destination?.label || p.destination,
              originLat: val.origin?.lat ?? null,
              originLng: val.origin?.lng ?? null,
              destinationLat: val.destination?.lat ?? null,
              destinationLng: val.destination?.lng ?? null,
              stops: val.stops || [],
              routeKm: route?.distanceKm ?? null,
              routeMin: route?.durationMin ?? null,
            }));
            setPicker(false);
          }}
        />
      )}
    </motion.div>
  );
}

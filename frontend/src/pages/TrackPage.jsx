import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getPublicTracking } from "../services/publicTrackService";
import "./trackPage.css";

const REFRESH_MS = 30000;

const STEPS = [
  { id: "scheduled", label: "Scheduled" },
  { id: "ready", label: "Ready to leave" },
  { id: "on_the_way", label: "On the way" },
  { id: "delivered", label: "Delivered" },
];

const fmt = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/** Keeps the page out of search results and the link out of any request this page makes. */
function useQuietHead() {
  useEffect(() => {
    const add = (name, content) => {
      const el = document.createElement("meta");
      el.name = name;
      el.content = content;
      document.head.appendChild(el);
      return el;
    };
    const metas = [add("robots", "noindex, nofollow"), add("referrer", "no-referrer")];
    const before = document.title;
    document.title = "Track your delivery";
    return () => {
      metas.forEach((m) => m.remove());
      document.title = before;
    };
  }, []);
}

/**
 * What a customer sees when they follow a tracking link.
 *
 * No sign-in, and nothing that is the driver's or the office's business: the
 * stage the delivery is at, and — when it has stopped — the reason, in the
 * words the office chose for the customer.
 */
export default function TrackPage() {
  const { token } = useParams();
  const [view, setView] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | gone | error
  const [stale, setStale] = useState("");

  useQuietHead();

  const load = useCallback(async (signal) => {
    try {
      const res = await getPublicTracking(token, { signal });
      if (res.gone) {
        setState("gone");
        setView(null);
        return;
      }
      setView(res.view);
      setState("ready");
      setStale("");
    } catch (err) {
      if (err?.name === "AbortError") return;
      // keep what is on screen; say the refresh failed rather than blanking it
      setStale(err.message || "Could not refresh.");
      setState((s) => (s === "ready" ? "ready" : "error"));
    }
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load(controller.signal);
    }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") load(controller.signal); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  if (state === "loading") {
    return <main className="trk"><div className="trk-card" role="status">Loading your delivery…</div></main>;
  }

  if (state === "gone") {
    return (
      <main className="trk">
        <div className="trk-card">
          <h1 className="trk-title">This tracking link is no longer available</h1>
          <p className="trk-muted">
            It may have expired or been replaced. Please ask the company that is delivering to you for a new link.
          </p>
        </div>
      </main>
    );
  }

  if (state === "error") {
    return (
      <main className="trk">
        <div className="trk-card">
          <h1 className="trk-title">We could not load your delivery</h1>
          <p className="trk-muted" role="alert">{stale}</p>
          <button type="button" className="trk-btn" onClick={() => load()}>Try again</button>
        </div>
      </main>
    );
  }

  // a delivery that was called off, or a load that came back: no progress to show
  const cancelled = view.stage === "cancelled" || view.stage === "not_delivered";
  const paused = view.stage === "paused";
  // while paused the delivery is, as far as the road goes, still on the way
  const at = paused ? "on_the_way" : view.stage;
  const index = STEPS.findIndex((s) => s.id === at);

  return (
    <main className="trk">
      <div className="trk-card">
        <div className="trk-brand">{view.company}</div>
        <h1 className="trk-title">Delivery {view.tripNo}</h1>
        {view.customer && <div className="trk-muted">For {view.customer}</div>}

        <div className="trk-route">
          <div><span className="trk-label">From</span><span>{view.origin}</span></div>
          <div><span className="trk-label">To</span><span>{view.destination}</span></div>
        </div>

        <div className="trk-status" data-stage={view.stage} role="status">
          {view.statusLabel}
        </div>

        {paused && view.pause && (
          <section className="trk-pause" aria-label="Why the delivery has stopped">
            <h2 className="trk-pause-title">{view.pause.reasonLabel}</h2>
            <p>{view.pause.message}</p>
            {fmt(view.pause.startedAt) && <div className="trk-muted">Since {fmt(view.pause.startedAt)}</div>}
          </section>
        )}

        {!cancelled && (
          <ol className="trk-steps" aria-label="Progress">
            {STEPS.map((step, i) => (
              <li
                key={step.id}
                className="trk-step"
                data-state={i < index || (view.stage === "delivered" && i === index) ? "done" : i === index ? "now" : "next"}
                aria-current={i === index ? "step" : undefined}
              >
                <span className="trk-dot" aria-hidden="true" />
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
        )}

        <dl className="trk-times">
          {fmt(view.departedAt) && <div><dt>Left</dt><dd>{fmt(view.departedAt)}</dd></div>}
          {view.stage === "delivered" && fmt(view.arrivedAt)
            ? <div><dt>Delivered</dt><dd>{fmt(view.arrivedAt)}</dd></div>
            : !cancelled && fmt(view.scheduledArrival) && <div><dt>Expected</dt><dd>{fmt(view.scheduledArrival)}</dd></div>}
        </dl>

        {view.pastPauses?.length > 0 && (
          <section className="trk-past" aria-label="Earlier stops">
            <h2 className="trk-h2">Earlier stops</h2>
            <ul>
              {view.pastPauses.map((p, i) => (
                <li key={i}>
                  <strong>{p.reasonLabel}</strong>
                  <span className="trk-muted">
                    {" "}{fmt(p.startedAt) || ""}{p.endedAt ? ` to ${fmt(p.endedAt)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="trk-foot">
          {stale ? <span role="alert">Could not refresh just now. Showing the last update.</span> : <span>Updates by itself every 30 seconds.</span>}
          {fmt(view.asOf) && <span> Last checked {fmt(view.asOf)}.</span>}
        </div>
      </div>
    </main>
  );
}

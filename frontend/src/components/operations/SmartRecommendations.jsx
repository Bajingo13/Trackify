import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Lightbulb, RefreshCw, Sparkles } from "lucide-react";
import { getDispatchRecommendations } from "../../services/operations/dispatchService";

/**
 * Loads the recommendation snapshot without creating another resource picker.
 * The actual choices stay in the dispatch board; this strip only explains
 * where the recommendation badges shown on those resource cards came from.
 */
export default function SmartRecommendations({ trip, onSnapshot }) {
  const tripId = trip?.trip_ticket_id ?? trip?.id;
  const request = useRef(0);
  const [state, setState] = useState({ status: "idle", data: null, error: null });

  const load = useCallback(async () => {
    if (!tripId) return;
    const token = ++request.current;
    setState((old) => ({ status: "loading", data: old.data, error: null }));
    try {
      const data = await getDispatchRecommendations(tripId);
      if (token !== request.current) return;
      setState({ status: "ready", data, error: null });
      onSnapshot?.(data);
    } catch (error) {
      if (token !== request.current) return;
      setState({ status: "error", data: null, error });
      onSnapshot?.(null);
    }
  }, [tripId, onSnapshot]);

  useEffect(() => {
    load();
    return () => { request.current += 1; };
  }, [load]);

  const topDriver = state.data?.drivers?.find((item) => item.eligible);
  const topVehicle = state.data?.vehicles?.find((item) => item.eligible);

  return (
    <section className="smart-guidance" aria-label="Smart dispatch guidance">
      <span className="smart-guidance-mark" aria-hidden="true"><Sparkles size={16} /></span>
      <div className="smart-guidance-copy">
        <strong>{state.status === "loading" ? "Checking the best operational fit…" : "Smart match guidance"}</strong>
        {state.status === "error" ? (
          <span className="smart-guidance-error">
            <AlertTriangle size={13} /> Recommendations unavailable.
            <button type="button" onClick={load}>Try again</button>
          </span>
        ) : state.data ? (
          <span>
            Recommended cards are marked in the lists below
            {topDriver ? <> · Driver: <b>{topDriver.name}</b></> : null}
            {topVehicle ? <> · Vehicle: <b>{topVehicle.plateNo}</b></> : null}
          </span>
        ) : (
          <span>Trackify data only—no paid API and no automatic assignment.</span>
        )}
      </div>
      {state.data && (
        <span className="smart-guidance-note"><Lightbulb size={13} /> Dispatcher still confirms the final pair.</span>
      )}
      {state.status === "ready" && (
        <button type="button" className="smart-refresh" onClick={load} aria-label="Refresh recommendations" title="Refresh recommendations">
          <RefreshCw size={14} />
        </button>
      )}
    </section>
  );
}

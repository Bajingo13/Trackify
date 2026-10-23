import { useEffect, useRef, useState } from "react";

/**
 * What a driver has typed into a form, kept on the phone until it is sent.
 *
 * A claim or a request typed at a gate is lost today if the app is closed, the
 * phone kills it in the background, or the driver taps away to check
 * something. A draft brings the words back next time the form opens.
 *
 * A draft is never sent by itself. It only fills the form in again; the driver
 * still presses Send, with signal, exactly as before — so the rule that
 * nothing reaches the office from the road without the driver confirming it
 * (offline rules) is unchanged.
 *
 * The form's clientRef is kept with the draft. If a send did reach the office
 * but its answer was lost, the draft survives (it is cleared only on a
 * confirmed send), and sending it again carries the same reference — which the
 * server recognises, so it is filed once, not twice.
 *
 * Text only. Photos are not kept: they are large, and a receipt photographed
 * yesterday is better taken again than silently attached.
 *
 * Per driver and per form, and dropped after a week: an old half-written claim
 * is more likely to confuse than to help.
 */

export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const keyFor = (driverId, form) => `trackify-driver-draft:${driverId}:${form}`;

export function loadDraft(driverId, form, now = Date.now()) {
  if (!driverId) return null;
  try {
    const raw = localStorage.getItem(keyFor(driverId, form));
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || typeof draft.values !== "object" || !Number.isFinite(draft.savedAt)) return null;
    if (now - draft.savedAt > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(keyFor(driverId, form));
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function saveDraft(driverId, form, values, clientRef) {
  if (!driverId) return;
  try {
    localStorage.setItem(keyFor(driverId, form), JSON.stringify({ values, clientRef, savedAt: Date.now() }));
  } catch {
    /* full or blocked: the form still works, it just is not kept */
  }
}

export function clearDraft(driverId, form) {
  if (!driverId) return;
  try {
    localStorage.removeItem(keyFor(driverId, form));
  } catch {
    /* nothing to do */
  }
}

/** The draft this form opened with, read once. */
export function useOpeningDraft(driverId, form) {
  const [draft] = useState(() => loadDraft(driverId, form));
  return draft;
}

/**
 * Keeps `values` as the draft while `hasContent(values)` is true, and removes
 * it when the form is emptied. The form's opening values are not a change, so
 * opening and closing an untouched form leaves nothing behind.
 */
export function useDraftSaver({ driverId, form, values, hasContent, clientRef, enabled = true }) {
  const firstRun = useRef(true);
  const serialised = JSON.stringify(values);

  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (!enabled) return;
    if (hasContent(values)) saveDraft(driverId, form, values, clientRef);
    else clearDraft(driverId, form);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialised, enabled, driverId, form, clientRef]);
}

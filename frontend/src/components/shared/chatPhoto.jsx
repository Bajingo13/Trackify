import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./chatPhoto.css";

/**
 * What dispatch and the driver app share about a photo in a chat thread.
 *
 * A photo sits behind an authenticated route, so an <img src> cannot fetch it;
 * each side supplies a `load` that returns a data URL. Everything else — when
 * to fetch, what to show while it is coming, how to open it full size — is the
 * same on both ends and lives here.
 */

/**
 * Fetches the photo once its place in the thread is near the screen, so a long
 * conversation does not download every picture in it on opening.
 *
 * `load` may change identity on every render; `key` is what says it is a
 * different photo.
 */
export function useChatPhoto(load, key) {
  const ref = useRef(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (near) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setNear(true);
        watcher.disconnect();
      }
    }, { rootMargin: "300px" });
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return undefined;
    let live = true;
    setFailed(false);
    loadRef.current()
      .then((url) => { if (live) { setSrc(url); setFailed(!url); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [near, key, attempt]);

  return { ref, src, failed, retry: () => setAttempt((n) => n + 1) };
}

/**
 * The photo at full size over everything else.
 *
 * Escape closes it and is not passed on: it is opened from inside a drawer,
 * which would otherwise close underneath it on the same keypress.
 */
export function PhotoViewer({ src, alt = "Photo", onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="cp-viewer" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <img className="cp-viewer-img" src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
      <div className="cp-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <a className="cp-viewer-btn" href={src} download="trackify-photo.jpg">Save</a>
        <button type="button" className="cp-viewer-btn" onClick={onClose} autoFocus>Close</button>
      </div>
    </div>,
    document.body
  );
}

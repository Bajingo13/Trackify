import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Thin MapLibre GL wrapper.
 *
 * Basemap style: keyless OpenFreeMap by default. For higher production limits,
 * set VITE_MAP_STYLE_URL to a MapTiler / Stadia / self-hosted style URL.
 *
 * props:
 *   center   [lng, lat]                 initial centre
 *   zoom     number
 *   markers  [{ id, lng, lat, color?, pulse?, popupHtml? }]
 *   routes   [{ id, geometry (GeoJSON LineString), color?, width? }]
 *   fitTo    [[lng,lat], ...]            fit the view to these points
 *   onClick  ({lat,lng}) => void         click-to-place
 *   height   css height (default 100%)
 *   interactive  bool
 */
/**
 * Default basemap: plain OpenStreetMap raster tiles, defined inline so there's
 * no external style-JSON fetch and no vector-tile pipeline to fail. Set
 * VITE_MAP_STYLE_URL to a MapTiler / Stadia / OpenFreeMap style URL for vector
 * tiles + higher production limits.
 */
const RASTER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: "osm-tiles", type: "raster", source: "osm" }],
};
const MAP_STYLE = import.meta.env.VITE_MAP_STYLE_URL || RASTER_STYLE;

export default function MapView({
  center = [125.6, 7.07],
  zoom = 6,
  markers = [],
  routes = [],
  fitTo = null,
  onClick,
  height = "100%",
  interactive = true,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerObjs = useRef(new Map());
  const readyRef = useRef(false);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  // ---- init once ----
  useEffect(() => {
    const container = containerRef.current;
    const map = new maplibregl.Map({
      container,
      style: MAP_STYLE,
      center,
      zoom,
      interactive,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    if (interactive) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    }
    map.on("click", (e) => onClickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    map.on("error", (e) => console.warn("[map]", e?.error?.message || e));
    map.on("load", () => {
      readyRef.current = true;
      map.resize();
      syncRoutes(map, routes);
    });

    // MapLibre often paints blank when its container's size isn't final at
    // init (flex/grid panels). Keep it in sync with the container.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);
    const raf1 = requestAnimationFrame(() => map.resize());
    const t = setTimeout(() => map.resize(), 300);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf1);
      clearTimeout(t);
      markerObjs.current.forEach((e) => e.marker.remove());
      markerObjs.current.clear();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- markers ----
  // Markers are kept by id and moved, never torn down and rebuilt. A live
  // vehicle's position updates many times a second while it is being
  // interpolated; recreating the DOM node each time would flicker, drop any
  // open popup, and restart the pulse animation on every frame.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const live = markers.filter((m) => Number.isFinite(m.lng) && Number.isFinite(m.lat));
    const seen = new Set();

    live.forEach((m, i) => {
      const key = m.id != null ? String(m.id) : `idx-${i}`;
      seen.add(key);
      let entry = markerObjs.current.get(key);

      if (!entry) {
        const el = document.createElement("div");
        const marker = new maplibregl.Marker({ element: el, anchor: "center" }).addTo(map);
        entry = { marker, el, className: "", color: "", popupHtml: null };
        markerObjs.current.set(key, entry);
      }

      const className = "tk-map-pin" + (m.pulse ? " tk-map-pin--pulse" : "");
      if (entry.className !== className) {
        entry.el.className = className;
        entry.className = className;
      }
      const color = m.color || "#2455D6";
      if (entry.color !== color) {
        entry.el.style.setProperty("--pin", color);
        entry.color = color;
      }
      if (entry.popupHtml !== m.popupHtml) {
        if (m.popupHtml) {
          entry.marker.setPopup(
            new maplibregl.Popup({ offset: 14, closeButton: false }).setHTML(m.popupHtml)
          );
        }
        entry.popupHtml = m.popupHtml;
      }

      entry.marker.setLngLat([m.lng, m.lat]);
    });

    for (const [key, entry] of markerObjs.current) {
      if (!seen.has(key)) {
        entry.marker.remove();
        markerObjs.current.delete(key);
      }
    }
  }, [markers]);

  // ---- routes ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    syncRoutes(map, routes);
  }, [routes]);

  // ---- fit ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitTo || fitTo.length === 0) return;
    const pts = fitTo.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!pts.length) return;
    if (pts.length === 1) {
      map.easeTo({ center: pts[0], zoom: Math.max(map.getZoom(), 11), duration: 600 });
      return;
    }
    const b = pts.reduce(
      (acc, p) => acc.extend(p),
      new maplibregl.LngLatBounds(pts[0], pts[0])
    );
    map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 600 });
  }, [fitTo]);

  return <div ref={containerRef} style={{ width: "100%", height }} className="tk-mapview" />;
}

function syncRoutes(map, routes) {
  const keep = new Set();
  routes.forEach((r) => {
    if (!r.geometry) return;
    const srcId = `route-${r.id}`;
    keep.add(srcId);
    const data = { type: "Feature", geometry: r.geometry, properties: {} };
    if (map.getSource(srcId)) {
      map.getSource(srcId).setData(data);
    } else {
      map.addSource(srcId, { type: "geojson", data });
      map.addLayer({
        id: `${srcId}-line`,
        type: "line",
        source: srcId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": r.color || "#2455D6",
          "line-width": r.width || 4,
          "line-opacity": 0.85,
        },
      });
    }
  });
  // drop routes no longer present
  (map.getStyle().layers || [])
    .filter((l) => l.id.startsWith("route-") && l.id.endsWith("-line"))
    .forEach((l) => {
      const srcId = l.id.replace(/-line$/, "");
      if (!keep.has(srcId)) {
        if (map.getLayer(l.id)) map.removeLayer(l.id);
        if (map.getSource(srcId)) map.removeSource(srcId);
      }
    });
}

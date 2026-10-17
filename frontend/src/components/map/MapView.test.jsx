import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* A stand-in for MapLibre that records what MapView asks of it. */
const fake = vi.hoisted(() => ({ maps: [] }));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor(options) {
      this.options = options;
      this.handlers = {};
      this.controls = [];
      this.fitBounds = vi.fn();
      this.easeTo = vi.fn();
      fake.maps.push(this);
    }
    on(event, fn) { (this.handlers[event] ||= []).push(fn); }
    emit(event, data) { (this.handlers[event] || []).forEach((fn) => fn(data)); }
    addControl(control, position) { this.controls.push({ control, position }); }
    resize() {}
    remove() {}
    getZoom() { return 9; }
    getSource() { return null; }
    addSource() {}
    addLayer() {}
    getStyle() { return { layers: [] }; }
  }
  class LngLatBounds {
    constructor(a) { this.points = [a]; }
    extend(p) { this.points.push(p); return this; }
  }
  class NavigationControl { constructor(o) { this.kind = "navigation"; this.o = o; } }
  class AttributionControl { constructor(o) { this.kind = "attribution"; this.o = o; } }
  class Marker {
    setLngLat() { return this; }
    addTo() { return this; }
    setPopup() { return this; }
    remove() {}
  }
  class Popup { setHTML() { return this; } }
  return { Map: FakeMap, LngLatBounds, NavigationControl, AttributionControl, Marker, Popup };
});
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

import MapView from "./MapView";

globalThis.ResizeObserver ||= class { observe() {} disconnect() {} };

const ROUTE = [[125.6, 7.07], [125.8, 7.4]];
const map = () => fake.maps.at(-1);
const fits = () => map().fitBounds.mock.calls.length;

/** Render, then let the style "load" the way MapLibre does. */
function show(props) {
  const view = render(<MapView {...props} />);
  act(() => map().emit("load"));
  return view;
}

describe("MapView", () => {
  beforeEach(() => { fake.maps.length = 0; });

  it("fits the route once it has loaded", () => {
    show({ fitTo: ROUTE });
    expect(fits()).toBe(1);
  });

  it("does not refit when the same points arrive as a new array", () => {
    // what every caller does: fitTo is rebuilt on each render
    const { rerender } = show({ fitTo: ROUTE, fitPadding: { top: 76 } });
    rerender(<MapView fitTo={ROUTE.map((p) => [...p])} fitPadding={{ top: 76 }} />);
    rerender(<MapView fitTo={ROUTE.map((p) => [...p])} fitPadding={{ top: 76 }} />);
    expect(fits()).toBe(1);
  });

  it("refits when the points really change", () => {
    const { rerender } = show({ fitTo: ROUTE });
    rerender(<MapView fitTo={[...ROUTE, [125.9, 7.5]]} />);
    expect(fits()).toBe(2);
  });

  describe("keepUserView", () => {
    it("keeps the zoom the driver chose, even as their position moves", () => {
      const { rerender } = show({ fitTo: ROUTE, keepUserView: true });
      // the driver pinches out (a move with a browser event behind it)
      act(() => map().emit("movestart", { originalEvent: new Event("wheel") }));
      rerender(<MapView fitTo={[...ROUTE, [125.61, 7.08]]} keepUserView />);
      rerender(<MapView fitTo={[...ROUTE, [125.62, 7.09]]} keepUserView />);
      expect(fits()).toBe(1);
    });

    it("is not fooled by the map's own fits", () => {
      const { rerender } = show({ fitTo: ROUTE, keepUserView: true });
      act(() => map().emit("movestart", {})); // the fit's own animation: no browser event
      rerender(<MapView fitTo={[...ROUTE, [125.61, 7.08]]} keepUserView />);
      expect(fits()).toBe(2);
    });

    it("brings the whole route back when asked, and follows again after that", () => {
      const { rerender } = show({ fitTo: ROUTE, keepUserView: true, refitSignal: 0 });
      act(() => map().emit("movestart", { originalEvent: new Event("pointerdown") }));
      rerender(<MapView fitTo={ROUTE} keepUserView refitSignal={1} />);
      expect(fits()).toBe(2);
      rerender(<MapView fitTo={[...ROUTE, [125.61, 7.08]]} keepUserView refitSignal={1} />);
      expect(fits()).toBe(3);
    });

    it("is off by default: other maps (the location picker) still jump to a new place", () => {
      const { rerender } = show({ fitTo: ROUTE });
      act(() => map().emit("movestart", { originalEvent: new Event("wheel") }));
      rerender(<MapView fitTo={[...ROUTE, [125.9, 7.5]]} />);
      expect(fits()).toBe(2);
    });
  });

  it("puts the + / − and the credit in the corners asked for", () => {
    show({ fitTo: ROUTE, controlsPosition: "bottom-right", attributionPosition: "bottom-left" });
    const where = Object.fromEntries(map().controls.map((c) => [c.control.kind, c.position]));
    expect(where).toEqual({ navigation: "bottom-right", attribution: "bottom-left" });
    expect(map().options.attributionControl).toBe(false);
  });

  it("keeps the old corners when nothing is asked", () => {
    show({ fitTo: ROUTE });
    const where = Object.fromEntries(map().controls.map((c) => [c.control.kind, c.position]));
    expect(where).toEqual({ navigation: "top-right", attribution: "bottom-right" });
  });
});

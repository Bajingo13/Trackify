import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { corridorTiles, loadTile, mayPrefetch, prefetchRoute, registerTileCache, setTileOfflineCheck } from "./tileCache";

/* Cache Storage, in memory: jsdom has none. */
function fakeCaches() {
  const store = new Map();
  const cache = {
    match: async (url) => (store.has(url) ? store.get(url).clone() : undefined),
    put: async (url, res) => { store.set(url, res); },
    keys: async () => [...store.keys()],
    delete: async (url) => store.delete(url),
  };
  return { store, api: { open: async () => cache } };
}

const setOnline = (v) => Object.defineProperty(navigator, "onLine", { value: v, configurable: true });
const tile = (bytes) => new Response(new Uint8Array(bytes), { status: 200 });

describe("map tiles kept for offline", () => {
  let c;
  beforeEach(() => {
    c = fakeCaches();
    globalThis.caches = c.api;
    setOnline(true);
  });
  afterEach(() => {
    delete globalThis.caches;
    vi.restoreAllMocks();
  });

  it("keeps a tile fetched online and draws it from the phone offline", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(tile([1, 2, 3]));
    const url = "https://tiles.example/10/1/2.png";
    expect(new Uint8Array(await loadTile(url))).toEqual(new Uint8Array([1, 2, 3]));
    await vi.waitFor(() => expect(c.store.has(url)).toBe(true));

    setOnline(false);
    globalThis.fetch.mockClear();
    expect(new Uint8Array(await loadTile(url))).toEqual(new Uint8Array([1, 2, 3]));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("falls back to the kept tile when the network fails without the phone noticing", async () => {
    const url = "https://tiles.example/10/1/3.png";
    c.store.set(url, tile([9]));
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    expect(new Uint8Array(await loadTile(url))).toEqual(new Uint8Array([9]));
  });

  it("never keeps a captive portal's page in place of a tile", async () => {
    const url = "https://tiles.example/10/1/4.png";
    c.store.set(url, tile([7]));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>Sign in</html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    expect(new Uint8Array(await loadTile(url))).toEqual(new Uint8Array([7]));
    expect(new Uint8Array(await c.store.get(url).clone().arrayBuffer())).toEqual(new Uint8Array([7]));
  });

  it("goes straight to the kept tile when the app knows it is offline", async () => {
    const url = "https://tiles.example/10/1/5.png";
    c.store.set(url, tile([5]));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    setTileOfflineCheck(() => true);
    try {
      expect(new Uint8Array(await loadTile(url))).toEqual(new Uint8Array([5]));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      setTileOfflineCheck(null);
    }
  });

  it("says so when a tile was never seen and there is no signal", async () => {
    setOnline(false);
    await expect(loadTile("https://tiles.example/10/9/9.png")).rejects.toThrow("not available offline");
  });

  it("registers its protocol with MapLibre once, unwrapping the real URL", async () => {
    const addProtocol = vi.fn();
    registerTileCache({ addProtocol });
    registerTileCache({ addProtocol });
    expect(addProtocol).toHaveBeenCalledTimes(1);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(tile([4]));
    const [name, load] = addProtocol.mock.calls[0];
    expect(name).toBe("cachedtile");
    await load({ url: "cachedtile://https://tiles.example/1/1/1.png" }, new AbortController());
    expect(globalThis.fetch).toHaveBeenCalledWith("https://tiles.example/1/1/1.png", expect.anything());
  });

  it("never bulk-downloads from OpenStreetMap's own tile server", async () => {
    expect(mayPrefetch("https://tile.openstreetmap.org/{z}/{x}/{y}.png")).toBe(false);
    expect(mayPrefetch("https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=k")).toBe(true);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(prefetchRoute("https://tile.openstreetmap.org/{z}/{x}/{y}.png", [[125.6, 7.07]], "a")).resolves.toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("warms a route's corridor from a provider of our own, once per route", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => tile([1]));
    const tpl = "https://tiles.example/{z}/{x}/{y}.png";
    const line = [[125.6, 7.07], [125.62, 7.09]];
    const n = await prefetchRoute(tpl, line, "trip-31");
    expect(n).toBe(corridorTiles(line).length);
    await expect(prefetchRoute(tpl, line, "trip-31")).resolves.toBe(0);
  });

  it("covers the road with a tile either side, at each zoom", () => {
    const tiles = corridorTiles([[125.6, 7.07]], [12]);
    expect(tiles).toHaveLength(9);
    expect(tiles.every((t) => t.startsWith("12/"))).toBe(true);
  });
});

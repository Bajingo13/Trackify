import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Paging over a list that is already in memory. The records stay together; only
 * the slice on screen changes.
 *
 *   const pg = usePagination(rows, { initialSize: 10, resetKey: `${search}|${status}`, storeKey: "exceptions" });
 *   pg.pageItems   // what to draw
 *   pg.setPage(2), pg.setPageSize(25)
 *
 * `resetKey` goes back to page 1 when it changes (a new search or filter, where
 * staying on page 4 of a shorter list would show nothing). The page is also kept
 * inside the list as it shrinks, so deleting or resolving the last row of the
 * last page lands on the new last page instead of an empty one. The chosen size
 * is remembered per `storeKey`, when there is storage to remember it in.
 */

export const PAGE_SIZES = [10, 25, 50, 100];

const read = (key, fallback, allowed) => {
  if (!key) return fallback;
  try {
    const n = Number(localStorage.getItem(`tk_pagesize_${key}`));
    return allowed.includes(n) ? n : fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  if (!key) return;
  try { localStorage.setItem(`tk_pagesize_${key}`, String(value)); } catch { /* private mode: the choice just is not remembered */ }
};

export function usePagination(items, { initialSize = 10, sizes = PAGE_SIZES, resetKey = "", storeKey = "" } = {}) {
  const [size, setSize] = useState(() => read(storeKey, initialSize, sizes));
  const [page, setPageState] = useState(1);

  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pages);

  const lastKey = useRef(resetKey);
  useEffect(() => {
    if (lastKey.current !== resetKey) {
      lastKey.current = resetKey;
      setPageState(1);
    }
  }, [resetKey]);

  const start = (current - 1) * size;
  const setPage = useCallback((p) => setPageState(Math.min(Math.max(1, Number(p) || 1), pages)), [pages]);
  const setPageSize = useCallback((n) => {
    const next = Number(n);
    if (!sizes.includes(next)) return;
    setSize(next);
    setPageState(1);
    write(storeKey, next);
  }, [sizes, storeKey]);

  return {
    page: current,
    pages,
    pageSize: size,
    sizes,
    total,
    from: total ? start + 1 : 0,
    to: Math.min(total, start + size),
    pageItems: items.slice(start, start + size),
    setPage,
    setPageSize,
  };
}

/**
 * The page numbers to show: always the first and last, the current one and its
 * neighbours, and "…" for the gaps. [1, "…", 4, 5, 6, "…", 12]
 */
export function pageWindow(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const wanted = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) { wanted.add(2); wanted.add(3); wanted.add(4); }
  if (page >= pages - 2) { wanted.add(pages - 1); wanted.add(pages - 2); wanted.add(pages - 3); }
  const list = [...wanted].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out = [];
  list.forEach((n, i) => {
    if (i && n - list[i - 1] > 1) out.push("…");
    out.push(n);
  });
  return out;
}

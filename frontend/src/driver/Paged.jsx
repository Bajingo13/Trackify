import { useRef } from "react"
import { usePagination } from "../hooks/usePagination"

/** Rows per page on a phone: smaller steps than the office's tables. */
export const DRIVER_PAGE_SIZES = [5, 10, 20, 50]

/**
 * A long list shown a page at a time. All the records stay in the list; only the
 * rows on the page are drawn, with a strip underneath to change how many and to
 * move through the rest.
 *
 *   <Paged items={rows} resetKey={query} storeKey="faq" noun="answers">
 *     {(pageRows) => <ul>{pageRows.map(...)}</ul>}
 *   </Paged>
 *
 * The strip is left out while everything fits on the smallest page.
 */
export default function Paged({ items, resetKey = "", storeKey = "", noun = "items", children }) {
  const pg = usePagination(items, { initialSize: 10, sizes: DRIVER_PAGE_SIZES, resetKey, storeKey: storeKey && `driver_${storeKey}` })
  const top = useRef(null)

  // moving to another page starts at the top of the list, not wherever the thumb was
  const goTo = (p) => {
    pg.setPage(p)
    top.current?.scrollIntoView?.({ block: "start", behavior: "smooth" })
  }

  return (
    <>
      <div ref={top} className="dr-paged-top" />
      {children(pg.pageItems)}
      {pg.total > DRIVER_PAGE_SIZES[0] && (
        <nav className="dr-pager" aria-label={`${noun} pages`}>
          <div className="dr-pager-count" aria-live="polite">
            Showing {pg.from}–{pg.to} of {pg.total} {noun}
          </div>
          <div className="dr-pager-row">
            <label className="dr-pager-size">
              <span>Per page</span>
              <select
                className="dr-pager-select"
                value={pg.pageSize}
                onChange={(e) => pg.setPageSize(Number(e.target.value))}
                aria-label="Rows per page"
              >
                {pg.sizes.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {pg.pages > 1 && (
              <div className="dr-pager-nav">
                <button type="button" className="dr-pager-btn" onClick={() => goTo(pg.page - 1)} disabled={pg.page === 1} aria-label="Previous page">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
                </button>
                <span className="dr-pager-page">Page {pg.page} of {pg.pages}</span>
                <button type="button" className="dr-pager-btn" onClick={() => goTo(pg.page + 1)} disabled={pg.page === pg.pages} aria-label="Next page">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                </button>
              </div>
            )}
          </div>
        </nav>
      )}
    </>
  )
}

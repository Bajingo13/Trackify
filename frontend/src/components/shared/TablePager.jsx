import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { pageWindow } from "../../hooks/usePagination";
import Select from "../ui/Select";
import "./tablePager.css";

/**
 * The strip under a table: how many rows per page, which rows are showing, and the
 * way to the rest. Pass it what usePagination returns.
 *
 *   <TablePager pager={pg} noun="exceptions" />
 *
 * With one page's worth of rows it still shows the dropdown and the count (so the
 * choice is there before the list grows) but no page buttons.
 */
export default function TablePager({ pager, noun = "rows" }) {
  const { page, pages, pageSize, sizes, total, from, to, setPage, setPageSize } = pager;
  if (total === 0) return null;

  return (
    <nav className="tk-pager" aria-label={`${noun} pages`}>
      <div className="tk-pager-size">
        <span id="tk-pager-size-label">Rows per page</span>
        <Select
          size="sm"
          aria-label="Rows per page"
          value={pageSize}
          onChange={(v) => setPageSize(Number(v))}
          options={sizes.map((n) => ({ value: n, label: String(n) }))}
        />
      </div>

      <div className="tk-pager-count" aria-live="polite">
        Showing {from}–{to} of {total} {noun}
      </div>

      {pages > 1 && (
        <div className="tk-pager-nav">
          <button type="button" className="tk-pager-btn" onClick={() => setPage(1)} disabled={page === 1} aria-label="First page">
            <ChevronsLeft size={15} />
          </button>
          <button type="button" className="tk-pager-btn" onClick={() => setPage(page - 1)} disabled={page === 1} aria-label="Previous page">
            <ChevronLeft size={15} />
          </button>
          {pageWindow(page, pages).map((n, i) =>
            n === "…" ? (
              <span key={`gap-${i}`} className="tk-pager-gap" aria-hidden="true">…</span>
            ) : (
              <button
                key={n}
                type="button"
                className={`tk-pager-btn tk-pager-num ${n === page ? "is-current" : ""}`}
                onClick={() => setPage(n)}
                aria-label={`Page ${n}`}
                aria-current={n === page ? "page" : undefined}
              >
                {n}
              </button>
            )
          )}
          <button type="button" className="tk-pager-btn" onClick={() => setPage(page + 1)} disabled={page === pages} aria-label="Next page">
            <ChevronRight size={15} />
          </button>
          <button type="button" className="tk-pager-btn" onClick={() => setPage(pages)} disabled={page === pages} aria-label="Last page">
            <ChevronsRight size={15} />
          </button>
        </div>
      )}
    </nav>
  );
}

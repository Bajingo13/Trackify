import { useState } from "react"
import { FAQ, FAQ_ACTIONS, FAQ_CATEGORIES, searchFaq } from "./faqContent"
import { tap } from "./native"
import ChipRow from "./ChipRow"
import Paged from "./Paged"

/**
 * Answers and troubleshooting guides, for the moment before a driver needs to
 * ask anyone: search it, or pick a topic, and open the question. A guide is a
 * short numbered list in the order things should be done; where the next step
 * is asking the office, the button under it goes straight to the right tool.
 *
 * It lives in the app and needs no signal.
 */
export default function DriverFaq({ onAction }) {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("all")
  const [open, setOpen] = useState(null)

  const shown = searchFaq({ query, category }, FAQ)

  return (
    <div className="dr-faq">
      <label className="dr-find-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <span className="dr-sr-only">Search the guides</span>
        <input
          className="dr-find-input"
          type="search"
          placeholder="Search: breakdown, signal, claims"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(null) }}
        />
      </label>

      <ChipRow className="dr-faq-cats" label="Topic">
        {[{ value: "all", label: "All" }, ...FAQ_CATEGORIES].map((c) => (
          <button
            key={c.value}
            type="button"
            className={`dr-chip ${category === c.value ? "on" : ""}`}
            aria-pressed={category === c.value}
            onClick={() => { setCategory(c.value); setOpen(null) }}
          >
            {c.label}
          </button>
        ))}
      </ChipRow>

      {shown.length === 0 ? (
        <div className="dr-empty">
          <div className="dr-empty-title">No answers match</div>
          <div className="dr-empty-text">Try a shorter word, or ask the office directly.</div>
          <button type="button" className="dr-btn" style={{ marginTop: 12 }} onClick={() => onAction?.("request")}>
            Contact the office
          </button>
        </div>
      ) : (
        <Paged items={shown} resetKey={`${query}|${category}`} storeKey="faq" noun="answers">
          {(rows) => (
        <ul className="dr-faq-list">
          {rows.map((item) => {
            const isOpen = open === item.id
            return (
              <li key={item.id} className="dr-faq-item" data-open={isOpen ? "yes" : "no"}>
                <button
                  type="button"
                  className="dr-faq-q"
                  aria-expanded={isOpen}
                  aria-controls={`faq-${item.id}`}
                  onClick={() => { tap("light"); setOpen(isOpen ? null : item.id) }}
                >
                  <span>{item.q}</span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="dr-faq-chev"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {isOpen && (
                  <div id={`faq-${item.id}`} className="dr-faq-a" role="region" aria-label={item.q}>
                    {item.a && <p>{item.a}</p>}
                    {item.steps && (
                      <ol className="dr-faq-steps">
                        {item.steps.map((step) => <li key={step}>{step}</li>)}
                      </ol>
                    )}
                    {item.action && (
                      <button type="button" className="dr-btn ghost dr-faq-action" onClick={() => onAction?.(item.action)}>
                        {FAQ_ACTIONS[item.action]}
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
          )}
        </Paged>
      )}
    </div>
  )
}

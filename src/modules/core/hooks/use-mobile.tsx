import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * Viewport-is-mobile, as a single shared subscription.
 *
 * Every caller used to run its own `useEffect` and register its own
 * `matchMedia` listener. That is one listener per COMPONENT INSTANCE, not per
 * call site — and `MyRosterShift` calls this, so a month of roster chips meant a
 * listener per shift card, each independently calling `setState` with the same
 * boolean on every resize.
 *
 * `useSyncExternalStore` inverts it: one `MediaQueryList`, one listener, one
 * cached snapshot, and React fans the result out. The snapshot is read during
 * render, so the first paint still has the correct value — the property the
 * previous lazy-effect version was rewritten to get. Regressing that put a >0.2
 * layout shift on the rosters page, so it is load bearing, not incidental.
 */

// `max-width: 767px` matches exactly when innerWidth < 768, so the query is the
// single source of truth for both the value and the change event. The previous
// version read `.matches` for the event but `window.innerWidth` for the value,
// which are two sources that can disagree mid-resize.
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

const subscribers = new Set<() => void>()
let mql: MediaQueryList | null = null
let snapshot = false

function handleChange() {
  const next = mql?.matches ?? false
  if (next === snapshot) return
  snapshot = next
  // Copy: a subscriber may unsubscribe while we notify.
  for (const cb of [...subscribers]) cb()
}

function subscribe(onStoreChange: () => void): () => void {
  if (subscribers.size === 0 && typeof window !== "undefined") {
    mql = window.matchMedia(QUERY)
    snapshot = mql.matches
    mql.addEventListener("change", handleChange)
  }
  subscribers.add(onStoreChange)

  return () => {
    subscribers.delete(onStoreChange)
    if (subscribers.size === 0 && mql) {
      mql.removeEventListener("change", handleChange)
      mql = null
    }
  }
}

function getSnapshot(): boolean {
  // Read live until the first subscriber attaches, so a component that renders
  // before `subscribe` runs still gets the real value rather than the `false`
  // default. Must stay cheap and side-effect free: React calls it every render.
  if (mql) return snapshot
  if (typeof window === "undefined") return false
  return window.matchMedia(QUERY).matches
}

/** Server/prerender has no viewport; assume desktop, matching the old behaviour. */
function getServerSnapshot(): boolean {
  return false
}

export function useIsMobile(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

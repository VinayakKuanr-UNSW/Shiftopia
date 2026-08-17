import { useEffect, useRef } from 'react';

/**
 * Contain keyboard focus inside a dialog while it is open, and give it back
 * when it closes.
 *
 * `role="dialog"` + `aria-modal="true"` tell a screen reader the rest of the
 * page is inert, but they do nothing for the keyboard: without a trap, Tab
 * walks straight out of the dialog and into the page behind it, where the user
 * is now operating controls they cannot see. That is the ARIA APG dialog
 * pattern's core requirement and WCAG 2.4.3 (Focus Order).
 *
 * Radix does this for us in its own Dialog, but the shift wizard deliberately
 * uses a custom z-40 overlay (so nested z-50 select dropdowns can portal above
 * it), so it has to do this itself.
 *
 * Returns a ref to attach to the dialog container.
 */
export function useFocusTrap<T extends HTMLElement>(isOpen: boolean) {
  const containerRef = useRef<T | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const container = containerRef.current;
    if (!container) return;

    // Remember where focus came from so it can be restored on close.
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const FOCUSABLE = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    // Deliberately NOT an offsetParent/getClientRects check. offsetParent is
    // null for any position:fixed subtree — which this dialog is — and is
    // always null under jsdom, so a layout-based visibility test silently
    // returns "nothing is focusable" and the trap never engages. Filter on
    // attributes instead: they mean the same thing and are computable without
    // layout.
    const focusable = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('hidden') && !el.closest('[hidden],[aria-hidden="true"]'),
      );

    // Move focus in. Prefer the first control; fall back to the container so
    // focus never stays behind on the page.
    const initial = focusable()[0] ?? container;
    if (!container.contains(document.activeElement)) {
      initial.focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // Wrap at both ends, and pull focus back if it has escaped entirely.
      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus({ preventScroll: true });
        }
      } else if (active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);

      // Restore focus to whatever opened the dialog, so the keyboard user
      // returns to their place in the grid rather than the top of the document.
      //
      // Only if that element is still in the document AND still reachable:
      // the opener may have unmounted, or may itself now sit inside a closed
      // overlay that is hidden but still mounted for its exit animation.
      // Focusing into an aria-hidden/inert subtree is exactly what Chrome
      // blocks with "Blocked aria-hidden on an element because its descendant
      // retained focus".
      const target = previouslyFocused.current;
      if (
        target?.isConnected &&
        !target.closest('[aria-hidden="true"],[inert]')
      ) {
        target.focus?.({ preventScroll: true });
      }
    };
  }, [isOpen]);

  return containerRef;
}

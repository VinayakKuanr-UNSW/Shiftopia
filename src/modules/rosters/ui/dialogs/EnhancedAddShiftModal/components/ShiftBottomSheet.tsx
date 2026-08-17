/**
 * ShiftBottomSheet — mobile bottom-sheet shell for the Add / Edit Shift form.
 *
 * Tall sheet (not a tiny popup): the shift form has too many fields to fit a
 * half sheet, so it draws up to 92dvh and behaves like a page while leaving a
 * strip of the roster grid visible behind it — the planner never loses the
 * "which date / group am I adding to" context that a route change would throw
 * away, and the strip is the affordance that says "this is dismissable".
 *
 * ── Why this renders through a portal ────────────────────────────────────
 * `position: fixed` is only viewport-relative while no ancestor establishes a
 * containing block for it, and `backdrop-filter` (plus `transform`, `filter`,
 * `contain`, `will-change`) does exactly that. The Templates page wraps its
 * editor in a `backdrop-blur-md` card with `overflow-hidden`, so an in-place
 * sheet rendered there was laid out and CLIPPED inside that card — it appeared
 * as a panel floating in the middle of the page instead of a drawer, with the
 * backdrop only dimming the card. Portalling to <body> is the only fix that
 * holds regardless of what any caller wraps the form in.
 *
 * Deliberately NOT vaul/Radix. Every dropdown inside this form (Select, Popover,
 * Command) portals to <body>; a Radix *modal* container marks those portals
 * aria-hidden/inert and kills pointer events, which is the whole reason the
 * desktop wizard is a custom z-40 overlay too. Same trade here: ~80 lines of
 * pointer handling in exchange for dropdowns that actually work.
 *
 * Handles: drag-to-dismiss from the grabber/header, iOS keyboard avoidance via
 * visualViewport, safe-area insets, background scroll lock, and Android hardware
 * back (data-state="open" + role="dialog" is what CapacitorBridge's
 * dismissTopOverlay looks for — it dispatches Escape, which the form's own
 * window keydown listener turns into a cancel).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/modules/core/lib/utils';

/** Drag distance (px) past which releasing dismisses the sheet. */
const DISMISS_DISTANCE = 130;
/** Flick speed (px/ms) that dismisses short of that distance. */
const DISMISS_VELOCITY = 0.55;
/** A flick still has to travel — otherwise a 3px twitch qualifies. */
const FLICK_MIN_DISTANCE = 56;
/** Pointer samples closer than one frame apart produce meaningless speeds
 *  (3px in 0.2ms reads as 15 px/ms), so they are not sampled at all. */
const MIN_SAMPLE_MS = 8;

interface DragState {
    startY: number;
    /** Latest position — drives the sheet's offset. */
    currentY: number;
    /** Last position/time actually sampled for velocity. */
    sampleY: number;
    sampleT: number;
    velocity: number;
}

interface ShiftBottomSheetProps {
    /** Called on backdrop tap, grabber swipe-down, or the header close button. */
    onDismiss: () => void;
    /** Pinned above the scroll area — title, context line, close button. */
    header: React.ReactNode;
    /** Pinned below the scroll area — validation summary + primary action. */
    footer: React.ReactNode;
    /** Scrollable form body. */
    children: React.ReactNode;
    /** Full-sheet drill-down layer (e.g. the employee picker), when present. */
    overlay?: React.ReactNode;
    label: string;
    /** Focus-trap container ref (see useFocusTrap — a custom overlay must trap its own). */
    containerRef?: React.Ref<HTMLDivElement>;
}

export const ShiftBottomSheet: React.FC<ShiftBottomSheetProps> = ({
    onDismiss,
    header,
    footer,
    children,
    overlay,
    label,
    containerRef,
}) => {
    const [dragY, setDragY] = useState(0);
    const [releasing, setReleasing] = useState(false);
    const dragRef = useRef<DragState | null>(null);

    /* ── Keyboard avoidance ──────────────────────────────────────────────
       A position:fixed sheet stays anchored to the LAYOUT viewport, so an open
       software keyboard covers the footer — i.e. the "Add Shift" button — with
       no way to scroll it back. visualViewport reports the covered strip; the
       sheet lifts by exactly that much and gives back the height so the body
       keeps scrolling instead of being pushed off-screen. */
    const [keyboardInset, setKeyboardInset] = useState(0);
    useEffect(() => {
        const vv = window.visualViewport;
        if (!vv) return;
        const onResize = () => {
            const covered = window.innerHeight - (vv.height + vv.offsetTop);
            setKeyboardInset(covered > 60 ? covered : 0);
        };
        onResize();
        vv.addEventListener('resize', onResize);
        vv.addEventListener('scroll', onResize);
        return () => {
            vv.removeEventListener('resize', onResize);
            vv.removeEventListener('scroll', onResize);
        };
    }, []);

    /* ── Background scroll lock ── */
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, []);

    /* ── Drag to dismiss ──────────────────────────────────────────────────
       Bound to the grabber + header only. Binding it to the body instead would
       fight every scroll gesture and every time/number input drag. */
    const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        // Let the close button (and anything else interactive we drop in the
        // header later) receive its own tap.
        if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
        dragRef.current = {
            startY: e.clientY,
            currentY: e.clientY,
            sampleY: e.clientY,
            sampleT: e.timeStamp,
            velocity: 0,
        };
        setReleasing(false);
        // Capture so a fast swipe that leaves the header still reports moves here.
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* stale pointer id */ }
    }, []);

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const d = dragRef.current;
        if (!d) return;
        d.currentY = e.clientY;
        const dt = e.timeStamp - d.sampleT;
        if (dt >= MIN_SAMPLE_MS) {
            d.velocity = (e.clientY - d.sampleY) / dt;
            d.sampleY = e.clientY;
            d.sampleT = e.timeStamp;
        }
        // Downwards only — an upward drag on a sheet already at 92dvh has
        // nowhere to go, and rubber-banding it just looks broken.
        setDragY(Math.max(0, e.clientY - d.startY));
    }, []);

    const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const d = dragRef.current;
        if (!d) return;
        dragRef.current = null;
        try {
            if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
        } catch { /* capture already released with the pointer */ }
        const travelled = Math.max(0, d.currentY - d.startY);
        if (
            travelled > DISMISS_DISTANCE ||
            (travelled > FLICK_MIN_DISTANCE && d.velocity > DISMISS_VELOCITY)
        ) {
            onDismiss();
            // Leave the sheet where the finger left it: the cancel-confirm dialog
            // may keep it mounted, and snapping back mid-prompt reads as "my
            // swipe did nothing".
            return;
        }
        setReleasing(true);
        setDragY(0);
    }, [onDismiss]);

    const sheet = (
        <div
            className="fixed inset-0 z-40 md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label={label}
            data-state="open"
            // The mobile bottom nav is z-[60] — above this sheet — so without
            // this it floats over the sticky submit button. BottomNavbar watches
            // for the attribute and slides itself out of the way.
            data-hide-bottom-nav="true"
        >
            {/* Backdrop — fades with the drag so the gesture feels connected. */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in-0 duration-200"
                style={dragY ? { opacity: Math.max(0, 1 - dragY / 400) } : undefined}
                onClick={onDismiss}
            />

            <div
                ref={containerRef}
                className={cn(
                    // max-h caps the drawer at 92dvh so a strip of the page stays
                    // visible above it; the inline height only ever wins when the
                    // keyboard leaves less room than that.
                    'absolute inset-x-0 bottom-0 max-h-[92dvh] flex flex-col overflow-hidden rounded-t-[28px]',
                    'bg-card dark:bg-[#0a0c10] text-foreground',
                    'shadow-[0_-20px_60px_-15px_rgba(0,0,0,0.5)]',
                    'animate-in slide-in-from-bottom duration-300 ease-out',
                    releasing && 'transition-transform duration-200 ease-out',
                )}
                style={{
                    // Everything above the keyboard, minus the status bar — which
                    // the WebView draws under (StatusBar.setOverlaysWebView(true)).
                    height: `calc(100dvh - ${keyboardInset}px - env(safe-area-inset-top, 0px))`,
                    bottom: keyboardInset,
                    ...(dragY ? { transform: `translateY(${dragY}px)` } : null),
                }}
            >
                {/* Grabber + header form the top drag surface. The pill is the only
                    visual cue that the sheet can be swiped away, so it is drawn
                    even though the header is draggable too. */}
                <div
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    className="flex-shrink-0 touch-none bg-card pt-2 dark:bg-[#0a0c10] border-b border-border/40"
                >
                    <div className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-muted-foreground/25" aria-hidden="true" />
                    {header}
                </div>

                {children}

                <div className="safe-area-bottom flex-shrink-0 border-t border-border/50 bg-card/95 backdrop-blur-xl dark:bg-[#0c0e14]/95">
                    {footer}
                </div>

                {overlay}
            </div>
        </div>
    );

    // Portalled for the containing-block reason in the file header. Guarded for
    // the SSR/test path where there is no document yet.
    return typeof document === 'undefined' ? sheet : createPortal(sheet, document.body);
};

export default ShiftBottomSheet;

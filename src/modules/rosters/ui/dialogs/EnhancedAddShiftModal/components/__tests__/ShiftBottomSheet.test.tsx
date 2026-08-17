import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ShiftBottomSheet } from '../ShiftBottomSheet';

/** The sheet drags from its grabber/header, so gestures target that element. */
function grabber() {
    return screen.getByTestId('sheet-header').parentElement as HTMLElement;
}

function renderSheet(onDismiss = vi.fn()) {
    render(
        <ShiftBottomSheet
            label="Add Shift"
            onDismiss={onDismiss}
            header={<div data-testid="sheet-header">Add Shift</div>}
            footer={<button type="button">Add Shift</button>}
        >
            <div data-testid="sheet-body">form</div>
        </ShiftBottomSheet>,
    );
    return onDismiss;
}

/**
 * jsdom has no pointer capture — the component guards for that, and these tests
 * would throw if it stopped.
 *
 * fireEvent stamps real timeStamps, so back-to-back synchronous events land
 * sub-millisecond apart and register as an enormous velocity. That is exactly
 * the pointer noise MIN_SAMPLE_MS/FLICK_MIN_DISTANCE exist to reject, so a
 * short drag here must snap back the same way a twitchy real finger does.
 */
function drag(el: HTMLElement, from: number, to: number) {
    fireEvent.pointerDown(el, { clientY: from, pointerId: 1 });
    fireEvent.pointerMove(el, { clientY: to, pointerId: 1 });
    fireEvent.pointerUp(el, { clientY: to, pointerId: 1 });
}

describe('ShiftBottomSheet', () => {
    afterEach(() => {
        document.body.style.overflow = '';
    });

    it('exposes itself as a modal dialog Android back can find', () => {
        renderSheet();

        const dialog = screen.getByRole('dialog', { name: 'Add Shift' });
        // CapacitorBridge.dismissTopOverlay selects on exactly this pair.
        expect(dialog).toHaveAttribute('data-state', 'open');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('renders header, body and footer in one sheet', () => {
        renderSheet();

        expect(screen.getByTestId('sheet-header')).toBeInTheDocument();
        expect(screen.getByTestId('sheet-body')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add Shift' })).toBeInTheDocument();
    });

    it('locks background scroll while open and restores it on unmount', () => {
        const { unmount } = render(
            <ShiftBottomSheet label="Add Shift" onDismiss={vi.fn()} header={null} footer={null}>
                <div />
            </ShiftBottomSheet>,
        );

        expect(document.body.style.overflow).toBe('hidden');
        unmount();
        expect(document.body.style.overflow).not.toBe('hidden');
    });

    it('dismisses on a swipe past the threshold', () => {
        const onDismiss = renderSheet();

        drag(grabber(), 100, 300);

        expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('snaps back on a short swipe instead of dismissing', () => {
        const onDismiss = renderSheet();

        drag(grabber(), 100, 150);

        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('ignores upward drags', () => {
        const onDismiss = renderSheet();

        drag(grabber(), 300, 40);

        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('lets header controls take their own taps instead of starting a drag', () => {
        const onDismiss = renderSheet();
        const onClose = vi.fn();

        render(
            <ShiftBottomSheet
                label="Edit Shift"
                onDismiss={onDismiss}
                header={<button type="button" onClick={onClose}>Close</button>}
                footer={null}
            >
                <div />
            </ShiftBottomSheet>,
        );

        const close = screen.getByRole('button', { name: 'Close' });
        fireEvent.pointerDown(close, { clientY: 100, pointerId: 2 });
        fireEvent.pointerMove(close, { clientY: 400, pointerId: 2 });
        fireEvent.pointerUp(close, { clientY: 400, pointerId: 2 });
        fireEvent.click(close);

        expect(onClose).toHaveBeenCalledOnce();
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('dismisses on a backdrop tap', () => {
        const onDismiss = renderSheet();

        const backdrop = screen.getByRole('dialog').firstElementChild as HTMLElement;
        fireEvent.click(backdrop);

        expect(onDismiss).toHaveBeenCalledOnce();
    });

    /**
     * A `backdrop-filter`/`transform` ancestor makes `position: fixed` resolve
     * against that ancestor instead of the viewport, and the Templates page has
     * exactly such a wrapper (backdrop-blur-md + overflow-hidden). Rendered in
     * place, the sheet was laid out and clipped inside that card — a panel
     * floating mid-page rather than a drawer. Escaping to <body> is the fix, so
     * the escape itself is what these two assert.
     */
    it('escapes its parent by rendering into document.body', () => {
        const { container } = render(
            <ShiftBottomSheet label="Add Shift" onDismiss={vi.fn()} header={null} footer={null}>
                <div data-testid="sheet-body">form</div>
            </ShiftBottomSheet>,
        );

        expect(container).toBeEmptyDOMElement();
        expect(screen.getByRole('dialog').parentElement).toBe(document.body);
    });

    it('survives a containing-block ancestor without being clipped by it', () => {
        const host = document.createElement('div');
        host.style.backdropFilter = 'blur(12px)';
        host.style.overflow = 'hidden';
        document.body.appendChild(host);

        render(
            <ShiftBottomSheet label="Add Shift" onDismiss={vi.fn()} header={null} footer={null}>
                <div />
            </ShiftBottomSheet>,
            { container: host },
        );

        expect(host.contains(screen.getByRole('dialog'))).toBe(false);
        host.remove();
    });

    it('draws up as a drawer, leaving the page behind it visible', () => {
        renderSheet();

        const panel = screen.getByRole('dialog').lastElementChild as HTMLElement;
        // Bottom-anchored and capped, NOT inset-0/full-height — the uncovered
        // strip is what tells the planner the sheet is dismissable.
        expect(panel.className).toContain('bottom-0');
        expect(panel.className).not.toContain('top-0');
        expect(panel.className).toContain('max-h-[92dvh]');
        // Rounded at rest, not only mid-drag.
        expect(panel.className).toContain('rounded-t-[28px]');
        expect(panel.className).toContain('slide-in-from-bottom');
    });
});

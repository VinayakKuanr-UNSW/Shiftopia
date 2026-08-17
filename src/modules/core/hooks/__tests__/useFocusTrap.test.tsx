import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import { useFocusTrap } from '../useFocusTrap';

/**
 * role="dialog" + aria-modal tell a screen reader the page behind is inert.
 * They do nothing for the keyboard — without a trap, Tab leaves the dialog and
 * the user operates controls they cannot see (ARIA APG dialog pattern; WCAG
 * 2.4.3 Focus Order).
 */

function Dialog({ open }: { open: boolean }) {
  const ref = useFocusTrap<HTMLDivElement>(open);
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Edit Shift">
      <button type="button">first</button>
      <button type="button">middle</button>
      <button type="button">last</button>
    </div>
  );
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>opener</button>
      <button type="button">outside-behind</button>
      <Dialog open={open} />
      {open && <button type="button" onClick={() => setOpen(false)}>close</button>}
    </>
  );
}

describe('useFocusTrap', () => {
  it('moves focus into the dialog when it opens', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'opener' }));
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus();
  });

  it('wraps forward from the last control back to the first', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'opener' }));

    screen.getByRole('button', { name: 'last' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus();
  });

  it('wraps backward from the first control to the last', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'opener' }));

    screen.getByRole('button', { name: 'first' }).focus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'last' })).toHaveFocus();
  });

  it('never lands on a control behind the dialog while tabbing', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'opener' }));

    const behind = screen.getByRole('button', { name: 'outside-behind' });
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(behind).not.toHaveFocus();
    }
  });

  it('restores focus to the opener when the dialog closes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'opener' });

    await user.click(opener);
    expect(opener).not.toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'close' }));
    expect(opener).toHaveFocus();
  });

  it('does nothing while closed', () => {
    render(<Harness />);
    // No dialog mounted, and focus is untouched on the body.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /**
   * Restoring focus into a hidden-but-still-mounted overlay is what produces
   * Chrome's "Blocked aria-hidden on an element because its descendant
   * retained focus" — the exact violation DrillDownPanel was hitting.
   */
  describe('focus restore refuses unreachable targets', () => {
    function HarnessIn({ wrapper }: { wrapper: 'aria-hidden' | 'inert' | 'none' }) {
      const [open, setOpen] = useState(false);
      const attrs =
        wrapper === 'aria-hidden' ? { 'aria-hidden': true as const }
        : wrapper === 'inert' ? ({ inert: '' } as Record<string, string>)
        : {};
      return (
        <>
          <div {...attrs}>
            <button type="button" onClick={() => setOpen(true)}>opener</button>
          </div>
          <Dialog open={open} />
          {open && <button type="button" onClick={() => setOpen(false)}>close</button>}
        </>
      );
    }

    it.each(['aria-hidden', 'inert'] as const)(
      'does not restore focus into a %s subtree',
      async (wrapper) => {
        const user = userEvent.setup();
        render(<HarnessIn wrapper={wrapper} />);
        // `hidden: true` — an aria-hidden subtree is excluded from the
        // accessibility tree, which is precisely the state under test.
        const opener = screen.getByRole('button', { name: 'opener', hidden: true });

        // Open via keyboard so the opener is genuinely the previously-focused node.
        opener.focus();
        await user.keyboard('{Enter}');
        await user.click(screen.getByRole('button', { name: 'close' }));

        expect(opener).not.toHaveFocus();
      },
    );

    it('still restores when the opener is reachable', async () => {
      const user = userEvent.setup();
      render(<HarnessIn wrapper="none" />);
      const opener = screen.getByRole('button', { name: 'opener' });

      opener.focus();
      await user.keyboard('{Enter}');
      await user.click(screen.getByRole('button', { name: 'close' }));

      expect(opener).toHaveFocus();
    });
  });
});

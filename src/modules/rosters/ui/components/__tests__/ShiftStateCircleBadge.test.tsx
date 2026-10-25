import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ShiftStateCircleBadge, STATE_ICONS } from '../ShiftStateCircleBadge';
import { SHIFT_STATE_BADGE_TOKENS, type ShiftStateID } from '../../../domain/shift-fsm';

describe('ShiftStateCircleBadge', () => {
  const allStates: ShiftStateID[] = [
    'S1',
    'S2',
    'S3',
    'S4',
    'S5',
    'S9',
    'S10',
    'S11',
    'S13',
    'S15',
  ];

  it.each(allStates)('renders state %s with expected icon, colors, and accessibility attributes', (stateId) => {
    const { container } = render(<ShiftStateCircleBadge stateId={stateId} />);

    const badge = screen.getByLabelText(`Shift state: ${stateId} (${SHIFT_STATE_BADGE_TOKENS[stateId].label})`);
    expect(badge).toBeInTheDocument();

    const token = SHIFT_STATE_BADGE_TOKENS[stateId];
    expect(badge).toHaveStyle({
      backgroundColor: token.bg,
      color: token.text,
    });
    expect(badge).toHaveAttribute('title', `${stateId} — ${token.label}`);
    expect(badge).toHaveClass('rounded-full', 'aspect-square');

    // Verify SVG icon is rendered inside
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass('w-3', 'h-3');
  });

  it('keeps Gavel icon for bidding (S5)', () => {
    const { container } = render(<ShiftStateCircleBadge stateId="S5" />);
    const badge = screen.getByLabelText('Shift state: S5 (Bidding)');
    expect(badge).toBeInTheDocument();

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('falls back gracefully on unknown state', () => {
    render(<ShiftStateCircleBadge stateId="UNKNOWN" />);
    const badge = screen.getByLabelText('Shift state: UNKNOWN (Unknown)');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveStyle({
      backgroundColor: SHIFT_STATE_BADGE_TOKENS.UNKNOWN.bg,
    });
  });
});

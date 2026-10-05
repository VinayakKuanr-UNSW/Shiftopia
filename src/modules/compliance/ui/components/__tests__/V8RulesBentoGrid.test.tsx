import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { V8RulesBentoGrid } from '../V8RulesBentoGrid';

describe('V8RulesBentoGrid', () => {
  it('renders all 22 V8 active labour rules and metrics', () => {
    render(<V8RulesBentoGrid />);

    // Bento stats metrics
    expect(screen.getByText('22')).toBeDefined();
    expect(screen.getByText('V8 Active Rules')).toBeDefined();
    expect(screen.getByText('16')).toBeDefined(); // 16 blocking
    expect(screen.getByText('6')).toBeDefined(); // 6 warnings

    // Check specific known V8 rules
    expect(screen.getByText('No Overlap')).toBeDefined();
    expect(screen.getByText('V8_NO_OVERLAP')).toBeDefined();
    expect(screen.getByText('Student Visa 48h Limit')).toBeDefined();
    expect(screen.getByText('V8_STUDENT_VISA_LIMIT')).toBeDefined();
    expect(screen.getByText('Minimum Rest Gap')).toBeDefined();
    expect(screen.getByText('V8_MIN_REST_GAP')).toBeDefined();
    expect(screen.getByText('Casual Security Daily Spread')).toBeDefined();
    expect(screen.getByText('V8_CASUAL_SECURITY_SPREAD')).toBeDefined();
  });

  it('filters rules by search query', () => {
    render(<V8RulesBentoGrid />);

    const searchInput = screen.getByPlaceholderText(/Search by rule name/i);
    fireEvent.change(searchInput, { target: { value: 'visa' } });

    // Should find student visa rule
    expect(screen.getByText('Student Visa 48h Limit')).toBeDefined();
    // Should NOT find unrelated rules
    expect(screen.queryByText('No Overlap')).toBeNull();
  });

  it('filters rules by category', () => {
    render(<V8RulesBentoGrid />);

    // Click on Legal & Statutory category tab
    const legalButton = screen.getByRole('button', { name: /Legal & Statutory/i });
    fireEvent.click(legalButton);

    expect(screen.getByText('Student Visa 48h Limit')).toBeDefined();
    expect(screen.getByText('Maximum Daily Engagements (Casual)')).toBeDefined();
    expect(screen.queryByText('No Overlap')).toBeNull();
  });

  it('filters rules by tier (blocking vs warning)', () => {
    render(<V8RulesBentoGrid />);

    // Click on Warnings filter button
    const warningsButton = screen.getByRole('button', { name: /Warnings \(6\)/i });
    fireEvent.click(warningsButton);

    expect(screen.getByText('Split Shift')).toBeDefined();
    expect(screen.getByText('Availability Match')).toBeDefined();
    expect(screen.queryByText('No Overlap')).toBeNull(); // No Overlap is BLOCKING
  });

  it('handles rule selection callback', () => {
    const handleSelect = vi.fn();
    render(<V8RulesBentoGrid onSelectRule={handleSelect} />);

    const ruleCard = screen.getByText('No Overlap').closest('.group');
    if (ruleCard) {
      fireEvent.click(ruleCard);
      expect(handleSelect).toHaveBeenCalledWith('V8_NO_OVERLAP');
    }
  });
});

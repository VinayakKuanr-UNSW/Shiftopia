import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { V8RulesTable } from '../V8RulesTable';

describe('V8RulesTable with Architecture Diagram & Full HC/SC Matrix', () => {
  it('renders architecture diagram and canonical V8 rules', () => {
    render(<V8RulesTable />);

    // Check architecture diagram presence
    expect(screen.getByText(/Shiftopia Multi-Layer Compliance & Solver Architecture/i)).toBeDefined();
    expect(screen.getAllByText(/Shift Shape Gate/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/CP-SAT Solver/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/V8 Labour Auditor/i)).toBeDefined();
    expect(screen.getByText(/Database Backstop/i)).toBeDefined();

    // Check table headers
    expect(screen.getByText(/^Rule$/i)).toBeDefined();
    expect(screen.getByText(/^Rule ID$/i)).toBeDefined();
    expect(screen.getByText(/^HC$/i)).toBeDefined();
    expect(screen.getByText(/^SC$/i)).toBeDefined();

    // Verify key canonical rules
    expect(screen.getByText('No Overlap')).toBeDefined();
    expect(screen.getByText('V8_NO_OVERLAP')).toBeDefined();
    expect(screen.getByText('HC-2')).toBeDefined();
  });

  it('switches view to Shift Shape Gate (exposing HC-8)', () => {
    render(<V8RulesTable />);

    // Click on Shift Shape Gate tab
    const shapeTab = screen.getByRole('button', { name: /Shift Shape Gate/i });
    fireEvent.click(shapeTab);

    // Minimum Engagement (HC-8) should be present
    expect(screen.getByText('Minimum Engagement')).toBeDefined();
    expect(screen.getByText('SHAPE_MIN_ENGAGEMENT')).toBeDefined();
    expect(screen.getByText('HC-8')).toBeDefined();
  });

  it('switches view to CP-SAT Solver Model (exposing HC-1, HC-6, HC-7, SC-1..6)', () => {
    render(<V8RulesTable />);

    // Click on CP-SAT Solver Model tab
    const solverTab = screen.getByRole('button', { name: /CP-SAT Solver Model/i });
    fireEvent.click(solverTab);

    // Should expose macro solver constraints
    expect(screen.getByText('Shift Coverage Requirement')).toBeDefined();
    expect(screen.getByText('HC-1')).toBeDefined();
    expect(screen.getByText('Time-Coupled Pool Capacity')).toBeDefined();
    expect(screen.getByText('HC-6')).toBeDefined();
    expect(screen.getByText('Minimum Contract Utilization')).toBeDefined();
    expect(screen.getByText('HC-7')).toBeDefined();
    expect(screen.getByText('Worker Shift Preference Matching')).toBeDefined();
    expect(screen.getByText('SC-1')).toBeDefined();
  });

  it('filters rules across layers by search query', () => {
    render(<V8RulesTable />);

    // Switch to ALL tab
    const allTab = screen.getByRole('button', { name: /^All \(/i });
    fireEvent.click(allTab);

    const searchInput = screen.getByPlaceholderText(/Search by rule name/i);
    fireEvent.change(searchInput, { target: { value: 'HC-12' } });

    expect(screen.getByText('Student Visa 48h Limit')).toBeDefined();
    expect(screen.queryByText('No Overlap')).toBeNull();
  });

  it('opens the rich Technical Inspector modal upon clicking rule row or info button', () => {
    render(<V8RulesTable />);

    // Click on "Maximum Daily Hours" row
    const row = screen.getByText('Maximum Daily Hours').closest('tr');
    if (row) {
      fireEvent.click(row);
    }

    // Modal should now be open
    expect(screen.getByText('Mathematical Constraint Expression')).toBeDefined();
    expect(screen.getByText('Solver Evaluation Procedure')).toBeDefined();
    expect(screen.getByText('Evaluation Threshold')).toBeDefined();
    expect(screen.getByText('Temporal Window')).toBeDefined();
  });
});

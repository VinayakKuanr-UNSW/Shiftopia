import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmployeeSelect } from '../EmployeeSelect';

describe('EmployeeSelect Component', () => {
    const employees = [
        { id: 'emp-1', first_name: 'Jane', last_name: 'Doe', contract_type: 'Casual', profiles: { full_name: 'Jane Doe' } },
        { id: 'emp-2', first_name: 'John', last_name: 'Smith', contract_type: 'Casual', profiles: { full_name: 'John Smith' } },
    ];

    it('renders trigger button with assigned employee name and eligible count badge', () => {
        render(
            <EmployeeSelect
                label="Assign Employee"
                employees={employees}
                value="emp-1"
                onChange={vi.fn()}
            />
        );

        expect(screen.getByText(/assign employee/i)).toBeInTheDocument();
        expect(screen.getByText('Jane Doe')).toBeInTheDocument();
        expect(screen.getByText(/2 eligible/i)).toBeInTheDocument();
    });

    it('renders unassigned placeholder when value is null', () => {
        render(
            <EmployeeSelect
                label="Assign Employee"
                employees={employees}
                value={null}
                onChange={vi.fn()}
            />
        );

        expect(screen.getByText(/leave unassigned \(open for bidding\)/i)).toBeInTheDocument();
    });

    it('opens popover with search bar and staff list', () => {
        render(
            <EmployeeSelect
                label="Assign Employee"
                employees={employees}
                value={null}
                onChange={vi.fn()}
            />
        );

        const trigger = screen.getByRole('button', { name: /assign employee/i });
        fireEvent.click(trigger);

        expect(screen.getByPlaceholderText(/search eligible staff by name\.\.\./i)).toBeInTheDocument();
        expect(screen.getByText('Jane Doe')).toBeInTheDocument();
        expect(screen.getByText('John Smith')).toBeInTheDocument();
        expect(screen.getByText('Leave Unassigned')).toBeInTheDocument();
        expect(screen.getByText(/nav/i)).toBeInTheDocument();
        expect(screen.getByText(/select/i)).toBeInTheDocument();
        expect(screen.getByText(/close/i)).toBeInTheDocument();
    });

    it('calls onChange with null when selecting Leave Unassigned', () => {
        const onChange = vi.fn();
        render(
            <EmployeeSelect
                label="Assign Employee"
                employees={employees}
                value="emp-1"
                onChange={onChange}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /assign employee/i }));
        const unassignedOption = screen.getByText('Leave Unassigned');
        fireEvent.click(unassignedOption);

        expect(onChange).toHaveBeenCalledWith(null);
    });

    it('calls onChange with employee id when selecting an employee', () => {
        const onChange = vi.fn();
        render(
            <EmployeeSelect
                label="Assign Employee"
                employees={employees}
                value={null}
                onChange={onChange}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /assign employee/i }));
        const employeeOption = screen.getByText('John Smith');
        fireEvent.click(employeeOption);

        expect(onChange).toHaveBeenCalledWith('emp-2');
    });
});

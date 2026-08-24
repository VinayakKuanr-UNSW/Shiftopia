import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SingleSelect } from '../SingleSelect';

describe('SingleSelect Component', () => {
    const options = [
        { id: 'tm3', name: 'TM3' },
        { id: 'supervisor', name: 'Supervisor' },
        { id: 'team_leader', name: 'Team Leader' },
    ];

    it('renders trigger button with label and selected option name', () => {
        render(
            <SingleSelect
                label="Operational Role"
                options={options}
                value="tm3"
                onChange={vi.fn()}
                required
            />
        );

        expect(screen.getByText(/operational role/i)).toBeInTheDocument();
        expect(screen.getByText('TM3')).toBeInTheDocument();
        expect(screen.getByText('*')).toBeInTheDocument();
    });

    it('opens popover with search bar and items list upon click', () => {
        render(
            <SingleSelect
                label="Operational Role"
                options={options}
                value="tm3"
                onChange={vi.fn()}
            />
        );

        const trigger = screen.getByRole('button', { name: /operational role/i });
        fireEvent.click(trigger);

        expect(screen.getByPlaceholderText(/search operational role\.\.\./i)).toBeInTheDocument();
        expect(screen.getByText('Supervisor')).toBeInTheDocument();
        expect(screen.getByText('Team Leader')).toBeInTheDocument();
        expect(screen.getByText(/nav/i)).toBeInTheDocument();
        expect(screen.getByText(/select/i)).toBeInTheDocument();
        expect(screen.getByText(/close/i)).toBeInTheDocument();
    });

    it('calls onChange and closes popover when an item is selected', () => {
        const onChange = vi.fn();
        render(
            <SingleSelect
                label="Operational Role"
                options={options}
                value="tm3"
                onChange={onChange}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /operational role/i }));
        const supervisorOption = screen.getByText('Supervisor');
        fireEvent.click(supervisorOption);

        expect(onChange).toHaveBeenCalledWith('supervisor');
    });
});

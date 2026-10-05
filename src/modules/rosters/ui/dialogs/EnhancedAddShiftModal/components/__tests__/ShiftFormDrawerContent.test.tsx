import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useForm, FormProvider } from 'react-hook-form';
import { ShiftFormDrawerContent, STEP, STEP_META } from '../ShiftFormDrawerContent';

// Helper test wrapper with react-hook-form
function TestWrapper({ defaultValues = {}, drawerProps = {} }: { defaultValues?: any; drawerProps?: any }) {
    const methods = useForm({
        defaultValues: {
            shift_date: '2026-08-25',
            group_type: 'convention_centre',
            sub_group_name: 'Set-up',
            role_id: 'role-1',
            target_employment_type: 'Casual',
            start_time: '09:00',
            end_time: '17:00',
            unpaid_break_minutes: 30,
            paid_break_minutes: 0,
            is_training: false,
            required_skills: [],
            required_licenses: [],
            event_ids: [],
            notes: '',
            assigned_employee_id: null,
            ...defaultValues,
        },
    });

    const defaultDrawerProps = {
        form: methods,
        isReadOnly: false,
        isPast: false,
        isStarted: false,
        isPublished: false,
        isTemplateMode: false,
        editMode: false,
        roles: [{ id: 'role-1', name: 'Event Operations Team Member' }, { id: 'role-2', name: 'Supervisor' }],
        remunerationLevels: [],
        employees: [
            { id: 'emp-1', first_name: 'Jane', last_name: 'Doe', contract_type: 'Casual', profiles: { full_name: 'Jane Doe' } },
            { id: 'emp-2', first_name: 'John', last_name: 'Smith', contract_type: 'Casual', profiles: { full_name: 'John Smith' } },
        ],
        skills: [{ id: 'sk-1', name: 'Forklift' }],
        licenses: [{ id: 'lic-1', name: 'RSA' }],
        events: [{ id: 'ev-1', name: 'Tech Expo 2026' }],
        rosters: [{
            id: 'roster-1',
            groups: [{
                id: 'grp-1',
                name: 'Convention Centre',
                external_id: 'convention_centre',
                subGroups: [{ id: 'sg-1', name: 'Set-up' }],
            }],
        }],
        rosterStructure: {},
        activeSubGroups: [],
        isLoadingData: false,
        isLoadingShifts: false,
        isGroupLocked: false,
        isSubGroupLocked: false,
        isRoleLocked: false,
        isEmployeeLocked: false,
        resolvedContext: { organizationName: 'ICC Sydney', departmentName: 'Event Delivery', subDepartmentName: 'Set-up', date: '2026-08-25' },
        selectedRosterId: 'roster-1',
        setSelectedRosterId: vi.fn(),
        shiftLength: 8,
        netLength: 7.5,
        hardValidation: { passed: true, errors: [] },
        isAssignmentEnabled: true,
        minShiftHours: 3,
        shape: { status: 'VALID', blocking: false, hits: [] },
        shapeBlockers: [],
        compliancePanel: { status: 'idle', run: vi.fn(), result: null },
        runV2Compliance: vi.fn(),
        isScheduleDefined: true,
        onCancel: vi.fn(),
        onSubmit: vi.fn(),
        canSave: true,
        ...drawerProps,
    };

    return (
        <FormProvider {...methods}>
            <ShiftFormDrawerContent {...(defaultDrawerProps as any)} />
        </FormProvider>
    );
}

describe('ShiftFormDrawerContent — 5-Stepper and Top Tabs Redesign', () => {
    it('renders all 5 top stepper tabs with appropriate ARIA roles', () => {
        render(<TestWrapper />);

        const tablist = screen.getByRole('tablist', { name: /shift creation steps/i });
        expect(tablist).toBeInTheDocument();

        const tabs = screen.getAllByRole('tab');
        expect(tabs).toHaveLength(5);

        expect(tabs[0]).toHaveTextContent(/role & context/i);
        expect(tabs[1]).toHaveTextContent(/requirements & notes/i);
        expect(tabs[2]).toHaveTextContent(/timings & breaks/i);
        expect(tabs[3]).toHaveTextContent(/assignment/i);
        expect(tabs[4]).toHaveTextContent(/compliance & review/i);

        // First tab should be selected initially
        expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
        expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    });

    it('navigates through steps 1-2-3-4-5 sequentially using Save & Continue', async () => {
        render(<TestWrapper />);

        // Step 1: Role & Context
        expect(screen.getByRole('tabpanel', { name: /role & context/i })).toBeInTheDocument();
        expect(screen.getByText(/role & organizational placement/i)).toBeInTheDocument();

        // Advance to Step 2
        const continueBtn = screen.getByRole('button', { name: /save & continue/i });
        fireEvent.click(continueBtn);

        // Step 2: Requirements & Notes
        expect(screen.getByRole('tabpanel', { name: /requirements & notes/i })).toBeInTheDocument();
        expect(screen.getByText(/requirements & handover notes/i)).toBeInTheDocument();

        // Advance to Step 3
        fireEvent.click(screen.getByRole('button', { name: /save & continue/i }));

        // Step 3: Timings & Breaks
        expect(screen.getByRole('tabpanel', { name: /timings & breaks/i })).toBeInTheDocument();
        expect(screen.getByText(/schedule & break allocation/i)).toBeInTheDocument();

        // Advance to Step 4
        fireEvent.click(screen.getByRole('button', { name: /save & continue/i }));

        // Step 4: Assignment
        expect(screen.getByRole('tabpanel', { name: /assignment/i })).toBeInTheDocument();
        expect(screen.getByText(/employee assignment/i)).toBeInTheDocument();

        // Advance to Step 5
        fireEvent.click(screen.getByRole('button', { name: /save & continue/i }));

        // Step 5: Compliance & Review
        expect(screen.getByRole('tabpanel', { name: /compliance & review/i })).toBeInTheDocument();
        expect(screen.getByText(/compliance audit & summary/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /create shift/i })).toBeInTheDocument();
    });

    it('navigates backwards using Back button', () => {
        render(<TestWrapper />);

        // Move to step 2
        fireEvent.click(screen.getByRole('button', { name: /save & continue/i }));
        expect(screen.getByRole('tabpanel', { name: /requirements & notes/i })).toBeInTheDocument();

        // Click Back
        const backBtn = screen.getByRole('button', { name: /back/i });
        fireEvent.click(backBtn);

        expect(screen.getByRole('tabpanel', { name: /role & context/i })).toBeInTheDocument();
    });

    it('allows direct tab navigation to unlocked steps', () => {
        render(<TestWrapper />);

        const tabs = screen.getAllByRole('tab');

        // Click Step 3 (Timings)
        fireEvent.click(tabs[2]);
        expect(screen.getByRole('tabpanel', { name: /timings & breaks/i })).toBeInTheDocument();
        expect(tabs[2]).toHaveAttribute('aria-selected', 'true');

        // Click Step 4 (Assignment)
        fireEvent.click(tabs[3]);
        expect(screen.getByRole('tabpanel', { name: /assignment/i })).toBeInTheDocument();
        expect(tabs[3]).toHaveAttribute('aria-selected', 'true');
    });

    it('supports keyboard ArrowRight / ArrowLeft navigation on tabs', () => {
        render(<TestWrapper />);

        const tabs = screen.getAllByRole('tab');
        tabs[0].focus();

        // ArrowRight -> Step 2
        fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
        expect(screen.getByRole('tabpanel', { name: /requirements & notes/i })).toBeInTheDocument();

        // ArrowRight -> Step 3
        fireEvent.keyDown(tabs[1], { key: 'ArrowRight' });
        expect(screen.getByRole('tabpanel', { name: /timings & breaks/i })).toBeInTheDocument();

        // ArrowLeft -> Step 2
        fireEvent.keyDown(tabs[2], { key: 'ArrowLeft' });
        expect(screen.getByRole('tabpanel', { name: /requirements & notes/i })).toBeInTheDocument();

        // Home -> Step 1
        fireEvent.keyDown(tabs[1], { key: 'Home' });
        expect(screen.getByRole('tabpanel', { name: /role & context/i })).toBeInTheDocument();
    });

    it('calls onCancel when Cancel button is clicked', () => {
        const onCancel = vi.fn();
        render(<TestWrapper drawerProps={{ onCancel }} />);

        const cancelBtn = screen.getByRole('button', { name: /cancel/i });
        fireEvent.click(cancelBtn);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('calls onSubmit on Step 5 when submit button is clicked', () => {
        const onSubmit = vi.fn();
        render(<TestWrapper drawerProps={{ onSubmit }} />);

        const tabs = screen.getAllByRole('tab');
        fireEvent.click(tabs[4]); // Jump to Step 5

        const submitBtn = screen.getByRole('button', { name: /create shift/i });
        fireEvent.click(submitBtn);
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });
});

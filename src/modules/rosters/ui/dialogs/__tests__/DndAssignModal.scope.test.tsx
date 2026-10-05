import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * DndAssignModal — WHICH JOB is this shift for?
 *
 * Availability became per-job: the same person can be Full-Time in Security,
 * where silence means available, and Casual in Set-up, where silence means
 * unavailable. So "is this employee available for this shift?" has no answer
 * until you know which job the shift belongs to.
 *
 * The modal resolves that from the shift row rather than from its caller. Both
 * production call sites hand it a display object — GroupModeView a
 * `ShiftDisplay`, RostersPlannerPage a loosely-typed drag payload — and neither
 * carries a sub-department. Adding a prop to both would have worked exactly
 * until the third caller, and a forgotten scope does not fail loudly: it
 * silently returns the person-wide answer, which is the bug this whole
 * workstream removes.
 *
 * The timing matters as much as the value. `panel.run()` fires once per open
 * and `buildInputs` reads the scope at call time, so running before the lookup
 * lands would evaluate the engine against person-wide availability and then
 * never re-run — a wrong verdict rendered as a finished one.
 */

const SETUP = '50000000-0000-0000-0000-000000000002';
const SECURITY = '50000000-0000-0000-0000-000000000001';

const h = vi.hoisted(() => ({
    /** Resolves the `shifts` lookup; held open to test the pre-lookup window. */
    deferred: null as null | { resolve: (v: string | null) => void },
    shiftLookups: [] as string[],
    slotCalls: [] as Array<{ employeeId: string; subDepartmentId: unknown }>,
    modeCalls: [] as Array<{ enabled: unknown; scope: unknown }>,
    runCalls: 0,
}));

vi.mock('@/platform/supabase/client', () => ({
    supabase: {
        from: (table: string) => ({
            select: () => ({
                eq: (_c: string, id: string) => {
                    if (table === 'shifts') h.shiftLookups.push(id);
                    return {
                        single: () =>
                            new Promise((resolve) => {
                                h.deferred = {
                                    resolve: (v) =>
                                        resolve({ data: { sub_department_id: v }, error: null }),
                                };
                            }),
                    };
                },
            }),
        }),
    },
}));

vi.mock('@/modules/availability/api/availability.api', () => ({
    getAvailabilitySlots: (employeeId: string, _s: string, _e: string, subDepartmentId?: unknown) => {
        h.slotCalls.push({ employeeId, subDepartmentId });
        return Promise.resolve([]);
    },
}));

vi.mock('@/modules/availability/state/useAvailabilityMode', () => ({
    useAvailabilityMode: (_id: unknown, enabled: unknown, scope: unknown) => {
        h.modeCalls.push({ enabled, scope });
        return { mode: 'OPT_IN', isLoading: false };
    },
}));

vi.mock('@/modules/compliance/ui/useCompliancePanel', () => ({
    useCompliancePanel: () => ({
        run: () => { h.runCalls += 1; },
        state: 'idle',
        result: null,
        canProceed: true,
        hasWarnings: false,
    }),
}));
vi.mock('@/modules/compliance/ui/CompliancePanel', () => ({
    CompliancePanel: () => <div data-testid="compliance-panel" />,
}));
vi.mock('@/modules/availability/api/availability-view.api', () => ({
    getAssignedShiftsForAvailability: () => Promise.resolve([]),
}));
vi.mock('@/modules/compliance/employee-context', () => ({
    fetchV8EmployeeContext: () => Promise.resolve({}),
    fetchEmployeeShiftsV2: () => Promise.resolve([]),
}));
vi.mock('@/modules/planning/unified/compliance/input-builder', () => ({
    buildAssignInput: (x: unknown) => x,
}));
vi.mock('@/modules/rosters/domain/availability-check', () => ({
    evaluateShiftAvailabilityFromSlots: () => ({ isWarning: false, message: '' }),
}));

const { DndAssignModal } = await import('../DndAssignModal');

function renderModal(extra: Record<string, unknown> = {}) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return render(
        <QueryClientProvider client={client}>
            <DndAssignModal
                open
                onClose={() => {}}
                onConfirm={() => {}}
                shiftId="shift-1"
                employeeId="emp-1"
                employeeName="Multi Contract"
                shiftRole="Team Member"
                shiftDate="2026-09-01"
                shiftStartTime="09:00"
                shiftEndTime="17:00"
                {...extra}
            />
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    h.deferred = null;
    h.shiftLookups = [];
    h.slotCalls = [];
    h.modeCalls = [];
    h.runCalls = 0;
});

describe('DndAssignModal — resolving the shift’s job', () => {
    it('looks the sub-department up from the shift row when the caller omits it', async () => {
        renderModal();
        await waitFor(() => expect(h.deferred).not.toBeNull());
        expect(h.shiftLookups).toEqual(['shift-1']);

        h.deferred!.resolve(SETUP);

        await waitFor(() => expect(h.slotCalls.length).toBeGreaterThan(0));
        expect(h.slotCalls.every((c) => c.subDepartmentId === SETUP)).toBe(true);
    });

    // The failure this guards is silent: a person-wide read returns MORE slots,
    // so the banner simply does not warn, and nothing on screen says why.
    it('never reads availability against the pre-lookup null', async () => {
        renderModal();
        await waitFor(() => expect(h.deferred).not.toBeNull());

        // The lookup is still in flight here — the window in which the old code
        // would have queried person-wide.
        expect(h.slotCalls).toEqual([]);

        h.deferred!.resolve(SETUP);
        await waitFor(() => expect(h.slotCalls.length).toBeGreaterThan(0));
        expect(h.slotCalls.some((c) => c.subDepartmentId == null)).toBe(false);
    });

    it('holds the compliance run until the job is known', async () => {
        renderModal();
        await waitFor(() => expect(h.deferred).not.toBeNull());
        expect(h.runCalls).toBe(0);

        h.deferred!.resolve(SETUP);
        await waitFor(() => expect(h.runCalls).toBe(1));
    });

    it('passes the resolved job to the availability MODE, not just the slot read', async () => {
        renderModal();
        await waitFor(() => expect(h.deferred).not.toBeNull());
        h.deferred!.resolve(SECURITY);

        await waitFor(() =>
            expect(h.modeCalls.at(-1)?.scope).toEqual({ subDepartmentId: SECURITY }),
        );
    });

    it('honours an explicit prop without querying the shift row', async () => {
        renderModal({ subDepartmentId: SECURITY });
        await waitFor(() => expect(h.slotCalls.length).toBeGreaterThan(0));
        expect(h.shiftLookups).toEqual([]);
        expect(h.slotCalls.every((c) => c.subDepartmentId === SECURITY)).toBe(true);
    });

    // An explicit null is a caller SAYING person-wide, which is a different
    // statement from not having thought about it.
    it('treats an explicit null as person-wide rather than as a missing value', async () => {
        renderModal({ subDepartmentId: null });
        await waitFor(() => expect(h.slotCalls.length).toBeGreaterThan(0));
        expect(h.shiftLookups).toEqual([]);
        expect(h.slotCalls.every((c) => c.subDepartmentId === null)).toBe(true);
    });
});

/**
 * `computeProposal` — the pure middle layer, tested without a database.
 *
 * THE REGRESSION THIS FILE EXISTS FOR. Office originally read its pattern
 * from ONE shared `roster_templates` row per sub-department. The four full-time
 * employees in production hold three different roles, and
 * `BFT_PATTERN_ROLE_MISMATCH` is BLOCKING — so a shared template raised a
 * blocking finding for three of them, and because a pattern-level failure
 * aborted the whole run, the fourth got nothing either. A working feature
 * generated exactly zero shifts for everybody.
 *
 * The fix is structural, and asserted here: patterns are per-employee, and one
 * unlawful pattern drops ONE person.
 *
 * That this can be tested at all — no mocks, no fixtures on disk, no database —
 * is the payoff of keeping the layer pure.
 */
import { describe, expect, it } from 'vitest';
import { computeProposal, type OfficeWorld } from '../office.commands';
import { rowsToPattern, type PatternRow } from '../../domain/patternRow';
import type { OfficePattern, EmployeeContractFacts } from '../../domain/types';
import type { EligibleEmployee } from '../office.loaders';

const SUB = 'sub-1';
const ORG = 'org-1';
const DEPT = 'dept-1';

/* 2024-07-15 is a Monday, and exactly 196 days (seven whole four-week cycles)
   after the 2024-01-01 anchor every contract in production declares — so the
   period below is one clean week at the head of a cycle. */
const PERIOD_START = '2024-07-15';
const PERIOD_END = '2024-07-21';
const REFERENCE = '2024-07-01';

const ROLES = {
    manager: 'role-manager',
    supervisor: 'role-supervisor',
    assistantManager: 'role-assistant-manager',
};

function facts(over: Partial<EmployeeContractFacts> = {}): EmployeeContractFacts {
    return {
        employeeId: 'emp-1',
        userContractId: 'uc-1',
        contractedWeeklyHours: 38,
        cycleWeeks: 4,
        cycleAnchor: '2024-01-01',
        contractStart: '2020-01-01',
        contractEnd: null,
        roleId: ROLES.supervisor,
        subDepartmentId: SUB,
        ...over,
    };
}

function employee(name: string, roleId: string, roleName: string, id: string): EligibleEmployee {
    return {
        name,
        roleName,
        avatarUrl: null,
        isSecurityRole: false,
        facts: facts({ employeeId: id, userContractId: `uc-${id}`, roleId }),
    };
}

/** The four full-time employees in production, with their real roles. */
const TEAM: EligibleEmployee[] = [
    employee('James Smith', ROLES.manager, 'Manager', 'emp-james'),
    employee('John Smith', ROLES.supervisor, 'Supervisor', 'emp-john'),
    employee('Kurry Admin', ROLES.supervisor, 'Supervisor', 'emp-kurry'),
    employee('Mary Smith', ROLES.assistantManager, 'Assistant Manager', 'emp-mary'),
];

function world(over: Partial<OfficeWorld> = {}): OfficeWorld {
    return {
        employees: TEAM,
        shiftsByEmployee: new Map(),
        leaveByEmployee: new Map(),
        publicHolidays: [],
        snapshotRefs: [],
        rawContracts: [],
        findings: [],
        ...over,
    };
}

/** A compliant Mon–Fri 7.6h week for one employee, in their own role. */
function compliantRow(employeeId: string, roleId: string): PatternRow {
    return {
        rowId: `row-${employeeId}`,
        employeeId,
        userContractId: `uc-${employeeId}`,
        weekInCycle: 1,
        days: [1, 2, 3, 4, 5],
        startTime: '08:00',
        endTime: '16:06',
        unpaidBreakMinutes: 30,
        roleId,
        slotIdByDay: {},
    };
}

function patternsFor(rows: readonly PatternRow[]): Map<string, OfficePattern> {
    const out = new Map<string, OfficePattern>();
    for (const e of TEAM) {
        out.set(e.facts.employeeId,
            rowsToPattern(e.facts.employeeId, e.facts.userContractId, SUB, rows));
    }
    return out;
}

function run(rows: readonly PatternRow[], over: Partial<OfficeWorld> = {}) {
    return computeProposal({
        world: world(over),
        patternsByEmployee: patternsFor(rows),
        organizationId: ORG,
        departmentId: DEPT,
        subDepartmentId: SUB,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        referenceDate: REFERENCE,
        generatedAt: '2024-07-01T00:00:00.000Z',
    });
}

/** Everyone on their own compliant pattern, in their own contracted role. */
const EVERYONE_COMPLIANT = TEAM.map(e =>
    compliantRow(e.facts.employeeId, e.facts.roleId));

describe('one unlawful pattern drops one employee, not the run', () => {
    it('schedules the other three when one names the wrong role', () => {
        // Mary is given the Manager role her contract does not authorise. Under
        // the old shared-template model this single mismatch aborted the entire
        // run; here it is her problem alone.
        const rows = EVERYONE_COMPLIANT.map(r => (
            r.employeeId === 'emp-mary' ? { ...r, roleId: ROLES.manager } : r));

        const p = run(rows);

        const mary = p.ledgers.find(l => l.employeeId === 'emp-mary')!;
        expect(mary.patternBlocked).toBe(true);
        expect(mary.proposed).toHaveLength(0);
        expect(mary.findings.some(f => f.code === 'BFT_PATTERN_ROLE_MISMATCH')).toBe(true);

        for (const id of ['emp-james', 'emp-john', 'emp-kurry']) {
            const l = p.ledgers.find(x => x.employeeId === id)!;
            expect(l.patternBlocked).toBe(false);
            expect(l.proposed.length).toBeGreaterThan(0);
        }

        expect(p.totals.blockedEmployees).toBe(1);
        expect(p.totals.employees).toBe(4);
    });

    it('still reports what a blocked employee is OWED', () => {
        // What somebody is contractually owed is a fact about their contract
        // and has nothing to do with whether their pattern is currently lawful.
        // Hiding it would leave the one row needing attention as the one row
        // with no numbers in it.
        const rows = EVERYONE_COMPLIANT.map(r => (
            r.employeeId === 'emp-mary' ? { ...r, roleId: ROLES.manager } : r));

        const mary = run(rows).ledgers.find(l => l.employeeId === 'emp-mary')!;
        expect(mary.requiredHours).toBeCloseTo(38, 1);   // 152h cycle x 7/28 days
        expect(mary.varianceHours).toBeCloseTo(38, 1);   // entirely unmet
    });

    it('an employee with no pattern at all proposes nothing and blocks nobody', () => {
        const p = run(EVERYONE_COMPLIANT.filter(r => r.employeeId !== 'emp-john'));

        const john = p.ledgers.find(l => l.employeeId === 'emp-john')!;
        expect(john.proposed).toHaveLength(0);
        expect(john.patternBlocked).toBe(true);
        expect(john.findings.some(f => f.code === 'BFT_PATTERN_EMPTY')).toBe(true);

        expect(p.ledgers.find(l => l.employeeId === 'emp-mary')!.proposed.length)
            .toBeGreaterThan(0);
    });
});

describe('the whole team on lawful patterns', () => {
    it('proposes five shifts each and clears the variance', () => {
        const p = run(EVERYONE_COMPLIANT);

        expect(p.totals.blockedEmployees).toBe(0);
        expect(p.totals.proposedShiftCount).toBe(20);       // 4 people x 5 days
        expect(p.totals.proposedHours).toBeCloseTo(152, 1); // 4 x 38h
        expect(p.totals.varianceHours).toBeCloseTo(0, 1);
    });

    it('refuses to over-roster when the pattern exceeds the contract', () => {
        // 08:00-16:30 is 8.0h net, 40h a week, 160h a cycle against 152.
        const rows = EVERYONE_COMPLIANT.map(r => ({ ...r, endTime: '16:30' }));
        const p = run(rows);

        expect(p.totals.blockedEmployees).toBe(4);
        expect(p.totals.proposedShiftCount).toBe(0);
        for (const l of p.ledgers) {
            expect(l.findings.some(f => f.code === 'BFT_PATTERN_EXCEEDS_CONTRACT')).toBe(true);
        }
    });

    it('stops short rather than proposing an unlawfully short day', () => {
        // Four 9.5h days is 38h exactly, so a seven-day window holds all four
        // and nothing is left over. Extending to five days would have to add a
        // fifth shift of zero length, which the generator never does.
        const rows = EVERYONE_COMPLIANT.map(r => (
            { ...r, days: [1, 2, 3, 4] as PatternRow['days'], endTime: '18:00' }));
        const p = run(rows);

        expect(p.totals.blockedEmployees).toBe(0);
        expect(p.totals.proposedShiftCount).toBe(16);      // 4 people x 4 days
        for (const l of p.ledgers) {
            expect(l.proposed.every(c => c.netMinutes >= 456)).toBe(true);
        }
    });
});

describe('determinism', () => {
    it('produces byte-identical output for identical inputs', () => {
        // The guarantee the pure layer exists for. It has to survive the fact
        // that the table now recomputes this on every keystroke.
        expect(JSON.stringify(run(EVERYONE_COMPLIANT)))
            .toBe(JSON.stringify(run(EVERYONE_COMPLIANT)));
    });

    it('does not depend on the order rows arrive in', () => {
        const shuffled = [...EVERYONE_COMPLIANT].reverse();
        expect(JSON.stringify(run(shuffled)))
            .toBe(JSON.stringify(run(EVERYONE_COMPLIANT)));
    });

    it('orders ledgers by name, so the table does not reshuffle as it is edited', () => {
        const names = run(EVERYONE_COMPLIANT).ledgers.map(l => l.name);
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });
});

describe('the window is not the cycle', () => {
    it('scales what is OWED to the window while capping against the whole cycle', () => {
        // Seven days of a 28-day cycle is a quarter of 152h. The ceiling itself
        // never moves: it belongs to the declared cycle (cl 35.1(a)), not to
        // whatever calendar a manager is looking through.
        const week = run(EVERYONE_COMPLIANT).ledgers[0];
        expect(week.requiredHours).toBeCloseTo(38, 1);
        expect(week.cycles[0].ceilingHours).toBe(152);

        const month = computeProposal({
            world: world(),
            patternsByEmployee: patternsFor(EVERYONE_COMPLIANT),
            organizationId: ORG, departmentId: DEPT, subDepartmentId: SUB,
            periodStart: '2024-07-15', periodEnd: '2024-08-11',
            referenceDate: REFERENCE, generatedAt: '2024-07-01T00:00:00.000Z',
        }).ledgers[0];

        expect(month.requiredHours).toBeCloseTo(152, 1);
        expect(month.cycles[0].ceilingHours).toBe(152);
    });

    it('warns about short notice without refusing to compute', () => {
        // cl 38.1 governs PUBLICATION and Office only creates drafts, so this
        // is a warning the manager may act on, never a gate.
        const p = computeProposal({
            world: world(),
            patternsByEmployee: patternsFor(EVERYONE_COMPLIANT),
            organizationId: ORG, departmentId: DEPT, subDepartmentId: SUB,
            periodStart: PERIOD_START, periodEnd: PERIOD_END,
            referenceDate: '2024-07-14',          // one day before the period
            generatedAt: '2024-07-01T00:00:00.000Z',
        });

        const notice = p.runFindings.find(f => f.code === 'BFT_SHORT_NOTICE')!;
        expect(notice.severity).toBe('WARNING');
        expect(notice.clause).toBe('ICC EBA cl 38.1');
        expect(p.totals.proposedShiftCount).toBe(20);
    });
});

describe('existing shifts are consumption', () => {
    it('does not propose a second shift on a day already worked', () => {
        // A second shift on one day is a split shift, which cl 39.1 does not
        // authorise for full-time Team Members.
        const p = run(EVERYONE_COMPLIANT, {
            shiftsByEmployee: new Map([['emp-john', [{
                id: 'sh-1', date: '2024-07-15',
                startTime: '08:00', endTime: '16:06', netMinutes: 456,
                subDepartmentId: SUB, rosterPublishedOrLocked: false,
            }]]]),
        });

        const john = p.ledgers.find(l => l.employeeId === 'emp-john')!;
        expect(john.proposed.some(c => c.shiftDate === '2024-07-15')).toBe(false);
        expect(john.existingHours).toBeCloseTo(7.6, 1);
    });

    it('counts hours worked in ANOTHER sub-department against the same ceiling', () => {
        // The 152h ceiling is a property of the person. Reading only the team
        // being rostered would over-roster anyone who works elsewhere too.
        const p = run(EVERYONE_COMPLIANT, {
            shiftsByEmployee: new Map([['emp-john', [{
                id: 'sh-2', date: '2024-07-16',
                startTime: '08:00', endTime: '16:06', netMinutes: 456,
                subDepartmentId: 'a-different-team', rosterPublishedOrLocked: true,
            }]]]),
        });

        const john = p.ledgers.find(l => l.employeeId === 'emp-john')!;
        expect(john.existingHours).toBeCloseTo(7.6, 1);
        expect(john.proposed.some(c => c.shiftDate === '2024-07-16')).toBe(false);
    });
});

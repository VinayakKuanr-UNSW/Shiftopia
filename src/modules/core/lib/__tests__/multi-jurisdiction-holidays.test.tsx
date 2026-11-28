import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  DEFAULT_JURISDICTION,
  getPublicHolidayName,
  getShiftDayType,
  isPublicHolidayISO,
} from '../holidays';
import {
  clearOrganizationJurisdictions,
  registerOrganizationJurisdiction,
  registerOrganizationJurisdictions,
  resolveJurisdiction,
} from '../jurisdiction-registry';
import { JurisdictionProvider, useJurisdiction } from '@/modules/core/hooks/useJurisdiction';
import { Calendar } from '@/modules/core/ui/primitives/calendar';
import { MonthGrid, WeekStrip } from '@/modules/core/ui/calendar';
import { buildAwardContext, getDateFacts } from '@/modules/rosters/domain/projections/utils/cost/award-context';
import { estimateDetailedShiftCost } from '@/modules/rosters/domain/projections/utils/cost/index';
import { computeShiftGrossPay } from '@/modules/payroll/domain/computeShiftGrossPay';
import { mapShiftRowToGrossPayInput } from '@/modules/payroll/data/grossPay.read.api';
import { evaluateShiftShape } from '@/modules/compliance/shape/evaluate';
import { templateShiftFromRow, validateTemplateApplication } from '@/modules/templates/model/templateShape';
import { runV8ComplexBridge } from '@/modules/compliance/v8/adapters/v2-to-v8';
import { v8Engine } from '@/modules/compliance/v8/engine';
import { resolveRequestedLeaveHours } from '@/modules/leave/domain/leave-hours';
import { computeCertificateAdjacency } from '@/modules/leave/domain/leave-policy';
import { projectFairnessImpact } from '@/modules/rosters/domain/fairness-ledger';
import { dayFairnessContribution } from '@/modules/availability/domain/team-metrics';

// Key 2026 state/city divergence dates:
const EKKA_2026 = '2026-08-12';           // Wed — AU-QLD-BNE only (Royal Queensland Show)
const EKKA_EVE_2026 = '2026-08-11';       // Tue — day before Ekka
const DAY_AFTER_EKKA_2026 = '2026-08-13'; // Thu — day after Ekka
const QLD_LABOUR_2026 = '2026-05-04';     // Mon — AU-QLD & AU-QLD-BNE only
const NSW_KINGS_BDAY_2026 = '2026-06-08'; // Mon — AU-NSW only
const OCT_HOLIDAY_2026 = '2026-10-05';    // Mon — NSW Labour Day AND QLD King's Birthday

const ORG_ICC = '11111111-1111-4111-8111-111111111111';
const ORG_BCEC = '22222222-2222-4222-8222-222222222222';

afterEach(() => {
  clearOrganizationJurisdictions();
});

describe('multi-jurisdiction holiday divergence sanity', () => {
  it('separates AU-NSW, AU-QLD, and AU-QLD-BNE on 2026 dates', () => {
    expect(isPublicHolidayISO(EKKA_2026, 'AU-QLD-BNE')).toBe(true);
    expect(isPublicHolidayISO(EKKA_2026, 'AU-QLD')).toBe(false);
    expect(isPublicHolidayISO(EKKA_2026, 'AU-NSW')).toBe(false);

    expect(isPublicHolidayISO(QLD_LABOUR_2026, 'AU-QLD-BNE')).toBe(true);
    expect(isPublicHolidayISO(QLD_LABOUR_2026, 'AU-QLD')).toBe(true);
    expect(isPublicHolidayISO(QLD_LABOUR_2026, 'AU-NSW')).toBe(false);

    expect(isPublicHolidayISO(NSW_KINGS_BDAY_2026, 'AU-NSW')).toBe(true);
    expect(isPublicHolidayISO(NSW_KINGS_BDAY_2026, 'AU-QLD')).toBe(false);
    expect(isPublicHolidayISO(NSW_KINGS_BDAY_2026, 'AU-QLD-BNE')).toBe(false);

    // Same calendar date, different state holiday names
    expect(getPublicHolidayName(new Date(2026, 9, 5), 'AU-NSW')).toMatch(/Labour Day/i);
    expect(getPublicHolidayName(new Date(2026, 9, 5), 'AU-QLD-BNE')).toMatch(/King's Birthday/i);
    expect(OCT_HOLIDAY_2026).toBe('2026-10-05');
  });
});

describe('jurisdiction registry & useJurisdiction resolution order', () => {
  it('prefers explicit jurisdiction, then registered organizationId, then DEFAULT_JURISDICTION', () => {
    registerOrganizationJurisdictions({ [ORG_ICC]: 'AU-NSW', [ORG_BCEC]: 'AU-QLD-BNE' });

    expect(resolveJurisdiction({ jurisdiction: 'AU-QLD', organizationId: ORG_ICC })).toBe('AU-QLD');
    expect(resolveJurisdiction({ organizationId: ORG_BCEC })).toBe('AU-QLD-BNE');
    expect(resolveJurisdiction({ organizationId: ORG_ICC })).toBe('AU-NSW');
    expect(resolveJurisdiction({ organizationId: 'unknown-org' })).toBe(DEFAULT_JURISDICTION);
    expect(resolveJurisdiction()).toBe(DEFAULT_JURISDICTION);
  });

  it('useJurisdiction works outside AuthProvider and honours JurisdictionProvider & orgIds', () => {
    registerOrganizationJurisdiction(ORG_BCEC, 'AU-QLD-BNE');
    registerOrganizationJurisdiction(ORG_ICC, 'AU-NSW');

    function Probe({ opts }: { opts?: Parameters<typeof useJurisdiction>[0] }) {
      const jur = useJurisdiction(opts);
      return <span data-testid="jur">{jur}</span>;
    }

    // Fallback with no provider
    const { rerender } = render(<Probe />);
    expect(screen.getByTestId('jur').textContent).toBe('AU-NSW');

    // Single BCEC org via organizationIds (GlobalScopeFilter)
    rerender(<Probe opts={{ organizationIds: [ORG_BCEC] }} />);
    expect(screen.getByTestId('jur').textContent).toBe('AU-QLD-BNE');

    // Mixed orgs fall through to JurisdictionProvider
    rerender(
      <JurisdictionProvider jurisdiction="AU-QLD-BNE">
        <Probe opts={{ organizationIds: [ORG_ICC, ORG_BCEC] }} />
      </JurisdictionProvider>,
    );
    expect(screen.getByTestId('jur').textContent).toBe('AU-QLD-BNE');
  });
});

describe('cost & award engines (standard, security, AwardContext)', () => {
  it('pre-computes AwardContext date facts per jurisdiction', () => {
    const nswCtx = buildAwardContext([EKKA_2026, QLD_LABOUR_2026, NSW_KINGS_BDAY_2026], undefined, 'AU-NSW');
    const bneCtx = buildAwardContext([EKKA_2026, QLD_LABOUR_2026, NSW_KINGS_BDAY_2026], undefined, 'AU-QLD-BNE');

    expect(getDateFacts(nswCtx, EKKA_2026).isPublicHoliday).toBe(false);
    expect(getDateFacts(bneCtx, EKKA_2026).isPublicHoliday).toBe(true);

    expect(getDateFacts(nswCtx, QLD_LABOUR_2026).isPublicHoliday).toBe(false);
    expect(getDateFacts(bneCtx, QLD_LABOUR_2026).isPublicHoliday).toBe(true);

    expect(getDateFacts(nswCtx, NSW_KINGS_BDAY_2026).isPublicHoliday).toBe(true);
    expect(getDateFacts(bneCtx, NSW_KINGS_BDAY_2026).isPublicHoliday).toBe(false);
  });

  it('prices Ekka (2026-08-12) with PH penalty for AU-QLD-BNE and ordinary weekday for AU-NSW in both standard and security engines', () => {
    const baseOpts = {
      netMinutes: 300, // 5h
      start_time: '09:00',
      end_time: '14:00',
      rate: null,
      scheduled_length_minutes: 300,
      is_overnight: false,
      is_cancelled: false,
      shift_date: EKKA_2026,
      employmentType: 'Casual' as const,
      classificationLevel: 'LEVEL_3',
    };

    const stdNsw = estimateDetailedShiftCost({ ...baseOpts, jurisdiction: 'AU-NSW' });
    const stdBne = estimateDetailedShiftCost({ ...baseOpts, jurisdiction: 'AU-QLD-BNE' });
    expect(stdNsw.penaltyBreakdown?.phHours).toBe(0);
    expect(stdBne.penaltyBreakdown?.phHours).toBe(5);
    expect(stdBne.totalCost).toBeGreaterThan(stdNsw.totalCost);

    // Explicit options.jurisdiction overrides a mismatched AwardContext
    const nswCtx = buildAwardContext([EKKA_2026], undefined, 'AU-NSW');
    const stdOverride = estimateDetailedShiftCost({ ...baseOpts, jurisdiction: 'AU-QLD-BNE' }, nswCtx);
    expect(stdOverride.totalCost).toBe(stdBne.totalCost);

    const secNsw = estimateDetailedShiftCost({ ...baseOpts, isSecurityRole: true, jurisdiction: 'AU-NSW' });
    const secBne = estimateDetailedShiftCost({ ...baseOpts, isSecurityRole: true, jurisdiction: 'AU-QLD-BNE' });
    expect(secNsw.penaltyBreakdown?.phHours).toBe(0);
    expect(secBne.penaltyBreakdown?.phHours).toBe(5);
    expect(secBne.totalCost).toBeGreaterThan(secNsw.totalCost);
  });

  it('splits an overnight shift crossing into Ekka (2026-08-11 22:00 → 04:00) using the shift jurisdiction', () => {
    const baseOpts = {
      netMinutes: 360,
      start_time: '22:00',
      end_time: '04:00',
      rate: null,
      scheduled_length_minutes: 360,
      is_overnight: true,
      is_cancelled: false,
      shift_date: EKKA_EVE_2026,
      employmentType: 'Casual' as const,
      classificationLevel: 'LEVEL_3',
    };

    const nsw = estimateDetailedShiftCost({ ...baseOpts, jurisdiction: 'AU-NSW' });
    const bne = estimateDetailedShiftCost({ ...baseOpts, jurisdiction: 'AU-QLD-BNE' });
    expect(nsw.penaltyBreakdown?.phHours).toBe(0);
    expect(bne.penaltyBreakdown?.phHours).toBe(4);
    expect(bne.totalCost).toBeGreaterThan(nsw.totalCost);
  });
});

describe('payroll gross pay & read adapter', () => {
  it('emits PH loading line on Ekka for AU-QLD-BNE only', () => {
    const common = {
      shiftId: 's-ekka',
      employeeId: 'e-1',
      shiftDate: EKKA_2026,
      netMinutes: 300,
      startTime: '09:00',
      endTime: '14:00',
      rate: null,
      employmentType: 'Casual' as const,
      classificationLevel: 'LEVEL_3',
    };

    const nswPay = computeShiftGrossPay({ ...common, jurisdiction: 'AU-NSW' });
    const bnePay = computeShiftGrossPay({ ...common, jurisdiction: 'AU-QLD-BNE' });

    expect(nswPay.lines.some((l) => /public holiday/i.test(l.description))).toBe(false);
    expect(bnePay.lines.some((l) => /public holiday/i.test(l.description))).toBe(true);
    expect(bnePay.grossPay).toBeGreaterThan(nswPay.grossPay);
  });

  it('mapShiftRowToGrossPayInput applies cl 56.2 4h PH floor on Ekka for BCEC rows and 3h for ICC Sydney rows', () => {
    const baseRow = {
      id: 's-1',
      shift_date: EKKA_2026,
      start_time: '09:00',
      end_time: '12:00', // 3h worked
      lifecycle_status: 'Completed',
      assignment_status: 'assigned',
      assigned_employee_id: 'emp-1',
      target_employment_type: 'Casual',
      remuneration_level: 3,
      _billable: {
        id: 'b-1',
        shift_id: 's-1',
        billable_start: '09:00',
        billable_end: '12:00',
        unpaid_break_minutes: 0,
        status: 'approved',
      },
    };

    const nswInput = mapShiftRowToGrossPayInput({
      ...baseRow,
      organization_id: ORG_ICC,
      organizations: { id: ORG_ICC, name: 'ICC Sydney', jurisdiction: 'AU-NSW' },
    });
    const bneInput = mapShiftRowToGrossPayInput({
      ...baseRow,
      organization_id: ORG_BCEC,
      organizations: { id: ORG_BCEC, name: 'BCEC', jurisdiction: 'AU-QLD-BNE' },
    });

    expect(nswInput?.jurisdiction).toBe('AU-NSW');
    expect(nswInput?.netMinutes).toBe(180); // 3h casual standard min

    expect(bneInput?.jurisdiction).toBe('AU-QLD-BNE');
    expect(bneInput?.netMinutes).toBe(240); // 4h cl 56.2 PH floor on Ekka!
  });
});

describe('compliance (shift shape, templates, V8 bridge)', () => {
  it('blocks a 3h casual shift on Ekka in AU-QLD-BNE (cl 56.2) but passes it in AU-NSW and AU-QLD', () => {
    const baseShape = {
      shift_date: EKKA_2026,
      start_time: '09:00',
      end_time: '12:00',
      unpaid_break_minutes: 0,
      paid_break_minutes: 0,
      target_employment_type: 'Casual' as const,
    };

    expect(evaluateShiftShape({ ...baseShape, jurisdiction: 'AU-NSW' }).blocking).toBe(false);
    expect(evaluateShiftShape({ ...baseShape, jurisdiction: 'AU-QLD' }).blocking).toBe(false);

    const bne = evaluateShiftShape({ ...baseShape, jurisdiction: 'AU-QLD-BNE' });
    expect(bne.blocking).toBe(true);
    expect(bne.hits.some((h) => h.rule_id === 'SHAPE_MIN_ENGAGEMENT_PH')).toBe(true);

    // Reverse on NSW King's Birthday (2026-06-08)
    const kingsNsw = evaluateShiftShape({ ...baseShape, shift_date: NSW_KINGS_BDAY_2026, jurisdiction: 'AU-NSW' });
    const kingsBne = evaluateShiftShape({ ...baseShape, shift_date: NSW_KINGS_BDAY_2026, jurisdiction: 'AU-QLD-BNE' });
    expect(kingsNsw.blocking).toBe(true);
    expect(kingsBne.blocking).toBe(false);
  });

  it('validateTemplateApplication checks Ekka against the template organization jurisdiction', () => {
    const placed = [
      {
        groupName: 'Main Hall',
        subGroupName: 'Audio',
        shift: templateShiftFromRow({
          id: 'tpl-shift-1',
          name: 'Short Morning',
          role_name: 'AV Technician',
          start_time: '09:00',
          end_time: '12:00',
          unpaid_break_minutes: 0,
          paid_break_minutes: 0,
          break_start: null,
          break_end: null,
          day_of_week: 3, // Wednesday (2026-08-12 is a Wednesday)
          target_employment_type: 'Casual',
          target_requires_flexible: false,
        }),
      },
    ];

    expect(validateTemplateApplication(placed, EKKA_2026, EKKA_2026, 'AU-NSW')).toHaveLength(0);
    const bneFailures = validateTemplateApplication(placed, EKKA_2026, EKKA_2026, 'AU-QLD-BNE');
    expect(bneFailures).toHaveLength(1);
    expect(bneFailures[0].dayType).toBe('public holiday');
  });

  it('runV8ComplexBridge derives is_public_holiday from shift jurisdiction / registered org', () => {
    registerOrganizationJurisdiction(ORG_BCEC, 'AU-QLD-BNE');
    registerOrganizationJurisdiction(ORG_ICC, 'AU-NSW');

    const evalSpy = vi.spyOn(v8Engine, 'evaluate');
    try {
      const baseInput = {
        employee_id: 'emp-1',
        employee_context: {
          employee_id: 'emp-1',
          contract_type: 'CASUAL' as const,
          contracted_weekly_hours: 0,
          ordinary_hours_cycle_weeks: 4 as const,
          ordinary_hours_cycle_anchor: '2026-01-05',
        },
        existing_shifts: [],
        mode: 'SIMULATED' as const,
        operation_type: 'ASSIGN' as const,
      };

      const makeShift = (organization_id: string) => ({
        id: 'cand-1',
        date: EKKA_2026,
        start_time: '09:00',
        end_time: '12:00',
        organization_id,
        required_qualifications: [],
        break_minutes: 0,
        unpaid_break_minutes: 0,
      });

      const nswShift = makeShift(ORG_ICC);
      const bneShift = makeShift(ORG_BCEC);

      runV8ComplexBridge({ ...baseInput, candidate_changes: { add_shifts: [nswShift], remove_shifts: [] } }, [nswShift]);
      const nswArg = evalSpy.mock.calls[0][1][0];
      expect(nswArg.is_public_holiday).toBe(false);
      expect(nswArg.jurisdiction).toBe('AU-NSW');

      runV8ComplexBridge({ ...baseInput, candidate_changes: { add_shifts: [bneShift], remove_shifts: [] } }, [bneShift]);
      const bneArg = evalSpy.mock.calls[1][1][0];
      expect(bneArg.is_public_holiday).toBe(true);
      expect(bneArg.jurisdiction).toBe('AU-QLD-BNE');
    } finally {
      evalSpy.mockRestore();
    }
  });
});

describe('leave hours, certificate adjacency, and casual fairness', () => {
  it('excludes Ekka from contract leave hours in AU-QLD-BNE but counts it in AU-NSW', () => {
    const base = {
      leaveType: 'annual' as const,
      startDate: '2026-08-10', // Mon
      endDate: '2026-08-14',   // Fri
      contractedWeeklyHours: 38,
    };

    const nsw = resolveRequestedLeaveHours({ ...base, jurisdiction: 'AU-NSW' });
    const bne = resolveRequestedLeaveHours({ ...base, jurisdiction: 'AU-QLD-BNE' });

    expect(nsw.daysCounted).toBe(5);
    expect(nsw.publicHolidaysSkipped).toEqual([]);
    expect(nsw.hours).toBe(38);

    expect(bne.daysCounted).toBe(4);
    expect(bne.publicHolidaysSkipped).toEqual([EKKA_2026]);
    expect(bne.hours).toBe(30.4);
  });

  it('flags leave adjacent to Ekka for AU-QLD-BNE only', () => {
    const nsw = computeCertificateAdjacency(DAY_AFTER_EKKA_2026, DAY_AFTER_EKKA_2026, { jurisdiction: 'AU-NSW' });
    const bne = computeCertificateAdjacency(DAY_AFTER_EKKA_2026, DAY_AFTER_EKKA_2026, { jurisdiction: 'AU-QLD-BNE' });

    expect(nsw.adjacentToPublicHoliday).toBe(false);
    expect(bne.adjacentToPublicHoliday).toBe(true);
  });

  it('tracks Ekka as public_holiday_hours in fairness impact & team day contribution for AU-QLD-BNE only', () => {
    const nswImpact = projectFairnessImpact([], {
      shiftDate: EKKA_2026,
      startTime: '09:00',
      endTime: '17:00',
      jurisdiction: 'AU-NSW',
    }, 4);
    const bneImpact = projectFairnessImpact([], {
      shiftDate: EKKA_2026,
      startTime: '09:00',
      endTime: '17:00',
      jurisdiction: 'AU-QLD-BNE',
    }, 4);

    expect(nswImpact.changed).not.toContain('public_holiday_hours');
    expect(bneImpact.changed).toContain('public_holiday_hours');

    const baseTeamShift = {
      id: 'ts-1',
      shiftDate: EKKA_2026,
      startTime: '09:00',
      endTime: '17:00',
      assignedEmployeeId: 'e-1',
      roleName: 'Event Staff',
      netMinutes: 480,
      isDraft: false,
      deptName: 'Ops',
      subDeptName: 'Floor',
      unpaidBreakMinutes: 0,
      targetEmploymentType: 'Casual',
    };

    const nswContrib = dayFairnessContribution([{ ...baseTeamShift, jurisdiction: 'AU-NSW' }]);
    const bneContrib = dayFairnessContribution([{ ...baseTeamShift, jurisdiction: 'AU-QLD-BNE' }]);

    expect(nswContrib?.labels).not.toContain('Public holiday');
    expect(bneContrib?.labels).toContain('Public holiday');
  });
});

describe('calendar UI primitives (Calendar, MonthGrid, WeekStrip)', () => {
  it('Calendar highlights Ekka in AU-QLD-BNE and not in AU-NSW', () => {
    const aug2026 = new Date(2026, 7, 1);
    const { rerender } = render(<Calendar month={aug2026} jurisdiction="AU-QLD-BNE" />);
    expect(screen.getByText(/Royal Queensland Show \(Ekka\), public holiday/)).toBeTruthy();

    rerender(<Calendar month={aug2026} jurisdiction="AU-NSW" />);
    expect(screen.queryByText(/Royal Queensland Show \(Ekka\)/)).toBeNull();
  });

  it('MonthGrid inherits jurisdiction from JurisdictionProvider', () => {
    const aug2026 = new Date(2026, 7, 1);
    render(
      <JurisdictionProvider jurisdiction="AU-QLD-BNE">
        <MonthGrid month={aug2026} />
      </JurisdictionProvider>,
    );
    expect(
      screen.getByRole('gridcell', { name: /12 August 2026.*Royal Queensland Show \(Ekka\), public holiday/i }),
    ).toBeTruthy();
  });

  it('WeekStrip marks Ekka for AU-QLD-BNE and not for AU-NSW', () => {
    const ekkaDate = new Date(2026, 7, 12);
    const { rerender } = render(<WeekStrip date={ekkaDate} jurisdiction="AU-QLD-BNE" />);
    expect(
      screen.getByLabelText(/Wednesday 12 August.*Royal Queensland Show \(Ekka\), public holiday/i),
    ).toBeTruthy();

    rerender(<WeekStrip date={ekkaDate} jurisdiction="AU-NSW" />);
    expect(screen.queryByLabelText(/Royal Queensland Show/i)).toBeNull();
  });

  it('getShiftDayType reflects AU-QLD-BNE vs AU-NSW on Ekka', () => {
    expect(getShiftDayType(EKKA_2026, 'AU-QLD-BNE')).toEqual({ isSunday: false, isPublicHoliday: true });
    expect(getShiftDayType(EKKA_2026, 'AU-NSW')).toEqual({ isSunday: false, isPublicHoliday: false });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  V8EmployeeContext,
  V8OrchestratorShift,
} from '@/modules/compliance/v8/orchestrator/types';
import {
  buildAssignInput,
  buildBidInput,
  buildDraftInput,
  buildSkeletonInput,
  buildSwapInputs,
  deriveV8Stage,
  resolveCandidateV8ShiftId,
} from '../../compliance/input-builder';
import {
  buildBidSnapshot,
  buildSwapSnapshot,
  combinedStatus,
  extractBlockingHits,
} from '../../compliance/snapshot-builder';
import type { PlanningOffer, PlanningRequest } from '../../types';
import {
  makeV8Hit,
  makeV8Result,
} from '../helpers/fixtures';

const employeeContext = (
  employeeId: string,
): V8EmployeeContext => ({
  employee_id: employeeId,
  contract_type: 'PART_TIME',
  contracted_weekly_hours: 24,
  assigned_role_ids: ['role-1'],
  contracts: [],
  qualifications: [],
});

const shift = (
  id: string,
  date: string,
  startTime: string,
  endTime: string,
): V8OrchestratorShift => ({
  id,
  date,
  start_time: startTime,
  end_time: endTime,
  is_ordinary_hours: true,
  required_qualifications: [],
  break_minutes: 30,
});

const partyAShift = shift(
  'shift-a',
  '2026-08-10',
  '09:00',
  '17:00',
);
const partyBShift = shift(
  'shift-b',
  '2026-08-11',
  '12:00',
  '20:00',
);

const request = (
  type: PlanningRequest['type'],
  shiftId = 'shift-a',
): PlanningRequest => ({
  id: 'request-1',
  type,
  status: 'OPEN',
  shift_id: shiftId,
  initiated_by: 'emp-a',
  target_employee_id: null,
  reason: null,
  compliance_snapshot: null,
  compliance_evaluated_at: null,
  manager_id: null,
  manager_notes: null,
  decided_at: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
});

const offer = (
  offeredShiftId: string | null,
): PlanningOffer => ({
  id: 'offer-1',
  request_id: 'request-1',
  offered_by: 'emp-b',
  offered_shift_id: offeredShiftId,
  status: 'SUBMITTED',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
});

afterEach(() => {
  vi.useRealTimers();
});

describe('planning compliance input builders', () => {
  it.each([
    [{ lifecycle_status: 'draft' }, 'DRAFT'],
    [{ lifecycle_status: 'UNPUBLISHED' }, 'DRAFT'],
    [{ is_published: false }, 'DRAFT'],
    [{ lifecycle_status: 'assigned' }, 'LIVE'],
    [{ lifecycle_status: 'LIVE' }, 'LIVE'],
    [{ lifecycle_status: 'confirmed' }, 'LIVE'],
    [{ lifecycle_status: 'scheduled', is_published: true }, 'PUBLISH'],
    [{}, 'PUBLISH'],
  ] as const)('derives the stage from %o', (input, expected) => {
    expect(deriveV8Stage(input)).toBe(expected);
  });

  it('builds a bid input without mutating the current schedule', () => {
    const context = employeeContext('emp-a');
    const existing = [partyAShift];

    const input = buildBidInput({
      employeeId: 'emp-a',
      employeeContext: context,
      existingShifts: existing,
      candidateShift: partyBShift,
      stage: 'PUBLISH',
    });

    expect(input).toEqual({
      employee_id: 'emp-a',
      employee_context: context,
      existing_shifts: existing,
      candidate_changes: {
        add_shifts: [partyBShift],
        remove_shifts: [],
      },
      mode: 'SIMULATED',
      operation_type: 'BID',
      stage: 'PUBLISH',
      evaluation_reference_date: partyBShift.date,
    });
  });

  it('builds mirrored swap inputs for both parties', () => {
    const result = buildSwapInputs({
      partyAEmployeeId: 'emp-a',
      partyAContext: employeeContext('emp-a'),
      partyAExistingShifts: [partyAShift],
      partyAShift,
      partyBEmployeeId: 'emp-b',
      partyBContext: employeeContext('emp-b'),
      partyBExistingShifts: [partyBShift],
      partyBShift,
      stage: 'LIVE',
    });

    expect(result.inputA.candidate_changes).toEqual({
      add_shifts: [partyBShift],
      remove_shifts: [partyAShift.id],
    });
    expect(result.inputA.evaluation_reference_date).toBe(partyBShift.date);
    expect(result.inputB.candidate_changes).toEqual({
      add_shifts: [partyAShift],
      remove_shifts: [partyBShift.id],
    });
    expect(result.inputB.evaluation_reference_date).toBe(partyAShift.date);
    expect(result.inputA.operation_type).toBe('SWAP');
    expect(result.inputB.operation_type).toBe('SWAP');
  });

  it('builds assign, draft and skeleton variants with their optional data', () => {
    const context = employeeContext('emp-a');
    const availabilityData = {
      declared_slots: [{
        slot_date: partyBShift.date,
        start_time: '08:00',
        end_time: '21:00',
      }],
      assigned_shifts: [],
    };

    const assignInput = buildAssignInput({
      employeeId: 'emp-a',
      employeeContext: context,
      existingShifts: [partyAShift],
      candidateShift: partyBShift,
      stage: 'LIVE',
      operationType: 'SWAP',
      availabilityData,
      removeShiftIds: [partyAShift.id],
    });
    const draftInput = buildDraftInput({
      employeeId: 'emp-a',
      employeeContext: context,
      existingShifts: [],
      candidateShift: partyBShift,
    });
    const skeletonInput = buildSkeletonInput({
      candidateShift: partyBShift,
      stage: 'PUBLISH',
    });

    expect(assignInput.availability_data).toBe(availabilityData);
    expect(assignInput.operation_type).toBe('SWAP');
    expect(assignInput.candidate_changes.remove_shifts).toEqual([
      partyAShift.id,
    ]);
    expect(draftInput.stage).toBe('DRAFT');
    expect(draftInput.operation_type).toBe('ASSIGN');
    expect(skeletonInput).toMatchObject({
      employee_id: 'skeleton',
      stage: 'PUBLISH',
      employee_context: {
        contract_type: 'CASUAL',
        contracted_weekly_hours: 0,
      },
      existing_shifts: [],
    });
  });

  it('resolves candidate shifts and rejects malformed swap offers', () => {
    expect(resolveCandidateV8ShiftId(
      request('BID', 'bid-shift'),
      offer(null),
    )).toBe('bid-shift');
    expect(resolveCandidateV8ShiftId(
      request('SWAP'),
      offer('offered-shift'),
    )).toBe('offered-shift');
    expect(() => resolveCandidateV8ShiftId(
      request('SWAP'),
      offer(null),
    )).toThrow('missing offered_shift_id');
  });
});

describe('planning compliance snapshot builders', () => {
  it.each([
    ['PASS', 'PASS', 'PASS'],
    ['PASS', 'WARNING', 'WARNING'],
    ['WARNING', 'PASS', 'WARNING'],
    ['WARNING', 'BLOCKING', 'BLOCKING'],
    ['BLOCKING', 'PASS', 'BLOCKING'],
  ] as const)('combines %s and %s as %s', (a, b, expected) => {
    expect(combinedStatus(a, b)).toBe(expected);
  });

  it('stamps bid and swap snapshots at a deterministic evaluation time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:34:56.000Z'));

    const bidResult = makeV8Result('PASS');
    const bidSnapshot = buildBidSnapshot({
      result: bidResult,
      shiftUpdatedAt: '2026-08-01T10:00:00.000Z',
    });
    const swapSnapshot = buildSwapSnapshot({
      resultA: makeV8Result('WARNING'),
      resultB: makeV8Result('BLOCKING'),
      shiftUpdatedAt: '2026-08-01T10:00:00.000Z',
      targetShiftUpdatedAt: '2026-08-01T11:00:00.000Z',
    });

    expect(bidSnapshot).toMatchObject({
      ...bidResult,
      shift_updated_at: '2026-08-01T10:00:00.000Z',
      evaluated_at: '2026-08-01T12:34:56.000Z',
    });
    expect(swapSnapshot).toMatchObject({
      combined_status: 'BLOCKING',
      shift_updated_at: '2026-08-01T10:00:00.000Z',
      target_shift_updated_at: '2026-08-01T11:00:00.000Z',
      evaluated_at: '2026-08-01T12:34:56.000Z',
    });
  });

  it('extracts only blocking bid hits and labels them as party A', () => {
    const snapshot = buildBidSnapshot({
      result: makeV8Result('BLOCKING', [
        makeV8Hit('R_BLOCK', 'BLOCKING', 'Blocking hit'),
        makeV8Hit('R_WARN', 'WARNING', 'Warning hit'),
      ]),
      shiftUpdatedAt: '2026-08-01T10:00:00.000Z',
    });

    expect(extractBlockingHits(snapshot)).toEqual([{
      rule_id: 'R_BLOCK',
      summary: 'Blocking hit',
      party: 'A',
      severity: 'BLOCKING',
    }]);
  });

  it('deduplicates shared swap rules and identifies party-specific hits', () => {
    const snapshot = buildSwapSnapshot({
      resultA: makeV8Result('BLOCKING', [
        makeV8Hit('R_SHARED', 'BLOCKING', 'Shared issue'),
        makeV8Hit('R_A', 'BLOCKING', 'Party A issue'),
      ]),
      resultB: makeV8Result('BLOCKING', [
        makeV8Hit('R_SHARED', 'BLOCKING', 'Shared issue from B'),
        makeV8Hit('R_B', 'BLOCKING', 'Party B issue'),
        makeV8Hit('R_WARNING', 'WARNING', 'Warning'),
      ]),
      shiftUpdatedAt: '2026-08-01T10:00:00.000Z',
      targetShiftUpdatedAt: '2026-08-01T11:00:00.000Z',
    });

    expect(extractBlockingHits(snapshot)).toEqual([
      {
        rule_id: 'R_SHARED',
        summary: '[Both parties] Shared issue',
        party: 'BOTH',
        severity: 'BLOCKING',
      },
      {
        rule_id: 'R_A',
        summary: 'Party A issue',
        party: 'A',
        severity: 'BLOCKING',
      },
      {
        rule_id: 'R_B',
        summary: 'Party B issue',
        party: 'B',
        severity: 'BLOCKING',
      },
    ]);
  });
});

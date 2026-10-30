import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  V8EmployeeContext,
  V8OrchestratorShift,
} from '@/modules/compliance/v8/orchestrator/types';
import {
  buildAssignInput,
  buildBidInput,
  buildSkeletonInput,
  buildSwapInputs,
} from '../../compliance/input-builder';

const employeeContext = (
  employeeId: string,
): V8EmployeeContext => ({
  employee_id: employeeId,
  contract_type: 'PART_TIME',
  contracted_weekly_hours: 24,
  ordinary_hours_cycle_weeks: 4,
  ordinary_hours_cycle_anchor: '2024-01-01',
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



afterEach(() => {
  vi.useRealTimers();
});

describe('planning compliance input builders', () => {

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
    const skeletonInput = buildSkeletonInput({
      candidateShift: partyBShift,
      stage: 'PUBLISH',
    });

    expect(assignInput.availability_data).toBe(availabilityData);
    expect(assignInput.operation_type).toBe('SWAP');
    expect(assignInput.candidate_changes.remove_shifts).toEqual([
      partyAShift.id,
    ]);
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
});

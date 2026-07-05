import { describe, it, expect } from 'vitest';
import { runV8Orchestrator } from '../orchestrator';
import type { V8OrchestratorInput } from '../orchestrator/types';

/**
 * Regression: min-engagement must validate only the shift being added, never
 * the employee's pre-existing shifts. Repro: employee has a committed 120-min
 * shift on 2026-07-01 (existing shifts arrive without is_training), and a new
 * 120-min TRAINING shift is created on 2026-07-02. The candidate passes (2h
 * training minimum); the existing short shift must NOT be re-flagged.
 */
function makeInput(opts: {
  candidateTraining: boolean;
  candidateEnd: string;
  withExistingShortShift: boolean;
}): V8OrchestratorInput {
  return {
    employee_id: 'emp-1',
    employee_context: {
      employee_id: 'emp-1',
      contract_type: 'CASUAL',
      contracted_weekly_hours: 38,
      assigned_role_ids: [],
      contracts: [],
      qualifications: [],
    },
    existing_shifts: opts.withExistingShortShift
      ? [{
          id: 'existing-1',
          date: '2026-07-01',
          shift_date: '2026-07-01',
          start_time: '16:00',
          end_time: '18:00', // 120 minutes, no is_training flag (as the RPC returns)
          role_id: 'role-1',
          required_qualifications: [],
          is_ordinary_hours: true,
          break_minutes: 0,
          unpaid_break_minutes: 0,
        } as any]
      : [],
    candidate_changes: {
      add_shifts: [{
        id: 'candidate-1',
        date: '2026-07-02',
        shift_date: '2026-07-02',
        start_time: '09:00',
        end_time: opts.candidateEnd,
        role_id: 'role-1',
        required_qualifications: [],
        is_ordinary_hours: true,
        is_training: opts.candidateTraining,
        break_minutes: 0,
        unpaid_break_minutes: 0,
      } as any],
      remove_shifts: [],
    },
    mode: 'SIMULATED',
    operation_type: 'ASSIGN',
    stage: 'DRAFT',
    config: {},
  };
}

describe('min-engagement candidate scoping (orchestrator)', () => {
  it('does not flag a pre-existing 120-min shift when adding a valid 2h training shift', () => {
    const res = runV8Orchestrator(
      makeInput({ candidateTraining: true, candidateEnd: '11:00', withExistingShortShift: true }),
      { stage: 'DRAFT' },
    );
    expect(res.hits.map(h => h.rule_id)).not.toContain('V8_MIN_ENGAGEMENT');
  });

  it('still flags the candidate itself when it is a non-training 2h shift', () => {
    const res = runV8Orchestrator(
      makeInput({ candidateTraining: false, candidateEnd: '11:00', withExistingShortShift: true }),
      { stage: 'DRAFT' },
    );
    const hit = res.hits.find(h => h.rule_id === 'V8_MIN_ENGAGEMENT');
    expect(hit).toBeTruthy();
    expect(hit!.affected_shifts).toContain('candidate-1');
    expect(hit!.affected_shifts).not.toContain('existing-1');
  });
});

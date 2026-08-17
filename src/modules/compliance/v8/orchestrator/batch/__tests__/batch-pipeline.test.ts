import { describe, expect, it } from 'vitest';

import type { V8Hit } from '../../../types';
import type {
  V8EmployeeContext,
  V8OrchestratorShift,
} from '../../types';
import {
  applyAtomics,
  buildInitialState,
  getEmployeeDelta,
} from '../simulator';
import { normalizeOperations } from '../normalizer';
import { buildDependencyGraph } from '../dependency-graph';
import { buildExecutionOrder } from '../ordering-engine';
import { detectConflicts } from '../conflict-detector';
import type { ComplianceValidationResult } from '../compliance-validator';
import type {
  AtomicOperation,
  BatchBaseState,
  BatchOperation,
  OperationGraph,
} from '../types';

const employee = (employeeId: string): V8EmployeeContext => ({
  employee_id: employeeId,
  contract_type: 'CASUAL',
  contracted_weekly_hours: 20,
  assigned_role_ids: ['role-1'],
  contracts: [],
  qualifications: [],
});

const shift = (
  id: string,
  startTime: string,
  endTime: string,
  date = '2026-08-03',
): V8OrchestratorShift => ({
  id,
  date,
  start_time: startTime,
  end_time: endTime,
  is_ordinary_hours: true,
  required_qualifications: [],
  break_minutes: 0,
});

const shifts = {
  morning: shift('shift-morning', '09:00', '12:00'),
  overlap: shift('shift-overlap', '11:00', '14:00'),
  afternoon: shift('shift-afternoon', '14:00', '18:00'),
};

const baseState: BatchBaseState = {
  shifts: Object.values(shifts),
  current_assignments: [
    { shift_id: shifts.morning.id, employee_id: 'emp-a' },
  ],
  employees: [employee('emp-a'), employee('emp-b'), employee('emp-c')],
  employee_existing_shifts: [
    { employee_id: 'emp-a', existing_shifts: [shifts.morning] },
    { employee_id: 'emp-b', existing_shifts: [] },
    { employee_id: 'emp-c', existing_shifts: [] },
  ],
};

const operation = (
  operationId: string,
  payload: BatchOperation['payload'],
  priority = 50,
  timestamp = '2026-08-01T00:00:00.000Z',
): BatchOperation => ({
  operation_id: operationId,
  type: payload.type,
  payload,
  priority,
  timestamp,
});

describe('batch operation normalization', () => {
  it('validates, deduplicates and expands every supported operation type', () => {
    const operations: BatchOperation[] = [
      operation('assign-low', {
        type: 'ASSIGN',
        shift_id: shifts.afternoon.id,
        employee_id: 'emp-a',
      }, 10),
      operation('assign-high', {
        type: 'ASSIGN',
        shift_id: shifts.afternoon.id,
        employee_id: 'emp-a',
      }, 90),
      operation('unassign', {
        type: 'UNASSIGN',
        shift_id: shifts.morning.id,
        employee_id: 'emp-a',
      }),
      operation('bid', {
        type: 'BID_ACCEPT',
        shift_id: shifts.overlap.id,
        winning_employee_id: 'emp-b',
        fallback_employee_ids: ['emp-c'],
      }),
      operation('swap', {
        type: 'SWAP_APPROVE',
        party_a: {
          employee_id: 'emp-a',
          gives_shift_id: shifts.morning.id,
        },
        party_b: {
          employee_id: 'emp-b',
          gives_shift_id: shifts.afternoon.id,
        },
      }),
      operation('missing-shift', {
        type: 'ASSIGN',
        shift_id: 'missing',
        employee_id: 'emp-a',
      }),
      operation('missing-fallback', {
        type: 'BID_ACCEPT',
        shift_id: shifts.overlap.id,
        winning_employee_id: 'emp-b',
        fallback_employee_ids: ['missing'],
      }),
      operation('same-party-swap', {
        type: 'SWAP_APPROVE',
        party_a: {
          employee_id: 'emp-a',
          gives_shift_id: shifts.morning.id,
        },
        party_b: {
          employee_id: 'emp-a',
          gives_shift_id: shifts.afternoon.id,
        },
      }),
    ];

    const result = normalizeOperations(operations, baseState);

    expect(result.valid_operations.map(op => op.operation_id)).toEqual([
      'assign-high',
      'unassign',
      'bid',
      'swap',
    ]);
    expect(result.invalid_operations).toHaveLength(3);
    expect(result.invalid_operations.map(item => item.operation_id)).toEqual([
      'missing-shift',
      'missing-fallback',
      'same-party-swap',
    ]);
    expect(result.atomics.get('assign-high')).toMatchObject([
      {
        type: 'ADD_EMPLOYEE_SHIFT',
        employee_id: 'emp-a',
        sequence_index: 0,
      },
    ]);
    expect(result.atomics.get('unassign')).toMatchObject([
      {
        type: 'REMOVE_EMPLOYEE_SHIFT',
        employee_id: 'emp-a',
      },
    ]);
    expect(result.atomics.get('bid')).toMatchObject([
      {
        type: 'ADD_EMPLOYEE_SHIFT',
        employee_id: 'emp-b',
      },
    ]);
    expect(result.atomics.get('swap')).toMatchObject([
      { type: 'REMOVE_EMPLOYEE_SHIFT', sequence_index: 0 },
      { type: 'REMOVE_EMPLOYEE_SHIFT', sequence_index: 1 },
      { type: 'ADD_EMPLOYEE_SHIFT', sequence_index: 2 },
      { type: 'ADD_EMPLOYEE_SHIFT', sequence_index: 3 },
    ]);
  });

  it('uses the earlier timestamp to break equal-priority duplicates', () => {
    const result = normalizeOperations([
      operation(
        'later',
        {
          type: 'ASSIGN',
          shift_id: shifts.afternoon.id,
          employee_id: 'emp-c',
        },
        50,
        '2026-08-01T02:00:00.000Z',
      ),
      operation(
        'earlier',
        {
          type: 'ASSIGN',
          shift_id: shifts.afternoon.id,
          employee_id: 'emp-c',
        },
        50,
        '2026-08-01T01:00:00.000Z',
      ),
    ], baseState);

    expect(result.valid_operations).toHaveLength(1);
    expect(result.valid_operations[0].operation_id).toBe('earlier');
  });
});

describe('batch dependency graph and ordering', () => {
  const operations: BatchOperation[] = [
    operation('release-morning', {
      type: 'UNASSIGN',
      shift_id: shifts.morning.id,
      employee_id: 'emp-a',
    }, 10),
    operation('claim-morning', {
      type: 'ASSIGN',
      shift_id: shifts.morning.id,
      employee_id: 'emp-b',
    }, 100),
    operation('claim-overlap-a', {
      type: 'ASSIGN',
      shift_id: shifts.overlap.id,
      employee_id: 'emp-a',
    }, 60),
    operation('claim-overlap-b', {
      type: 'ASSIGN',
      shift_id: shifts.overlap.id,
      employee_id: 'emp-b',
    }, 50),
    operation('claim-afternoon-a', {
      type: 'ASSIGN',
      shift_id: shifts.afternoon.id,
      employee_id: 'emp-a',
    }, 40),
  ];

  it('finds release dependencies, resource contention and employee overlap', () => {
    const graph = buildDependencyGraph(
      normalizeOperations(operations, baseState),
    );

    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from_op_id: 'release-morning',
        to_op_id: 'claim-morning',
        type: 'DEPENDENCY',
      }),
      expect.objectContaining({
        from_op_id: 'claim-overlap-a',
        to_op_id: 'claim-overlap-b',
        type: 'CONFLICT',
      }),
      expect.objectContaining({
        from_op_id: 'claim-morning',
        to_op_id: 'claim-overlap-b',
        type: 'CONFLICT',
      }),
    ]));
    expect(graph.dependencies.get('claim-morning')).toEqual(
      new Set(['release-morning']),
    );
    expect(graph.conflicts.get('claim-overlap-a')).toEqual(
      new Set(['claim-overlap-b']),
    );
    expect(graph.conflicts.get('claim-overlap-b')).toEqual(
      new Set(['claim-overlap-a', 'claim-morning']),
    );
  });

  it('respects dependencies before priority and reports dependency cycles', () => {
    const graph = buildDependencyGraph(
      normalizeOperations(operations, baseState),
    );
    const ordered = buildExecutionOrder(graph);
    const ids = ordered.sorted_operations.map(op => op.operation_id);

    expect(ids.indexOf('release-morning')).toBeLessThan(
      ids.indexOf('claim-morning'),
    );
    expect(ordered.cyclic_operations).toEqual([]);

    const cycleA = operation('cycle-a', {
      type: 'ASSIGN',
      shift_id: shifts.overlap.id,
      employee_id: 'emp-a',
    });
    const cycleB = operation('cycle-b', {
      type: 'ASSIGN',
      shift_id: shifts.afternoon.id,
      employee_id: 'emp-b',
    });
    const cyclicGraph: OperationGraph = {
      nodes: new Map([
        ['cycle-a', cycleA],
        ['cycle-b', cycleB],
      ]),
      edges: [],
      dependencies: new Map([
        ['cycle-a', new Set(['cycle-b'])],
        ['cycle-b', new Set(['cycle-a'])],
      ]),
      dependents: new Map([
        ['cycle-a', new Set(['cycle-b'])],
        ['cycle-b', new Set(['cycle-a'])],
      ]),
      conflicts: new Map([
        ['cycle-a', new Set()],
        ['cycle-b', new Set()],
      ]),
    };

    expect(buildExecutionOrder(cyclicGraph)).toEqual({
      sorted_operations: [],
      cyclic_operations: ['cycle-a', 'cycle-b'],
    });
  });
});

describe('batch simulation and conflict detection', () => {
  it('applies valid atomics, rolls back failed parents and calculates deltas', () => {
    const state = buildInitialState(baseState);
    const valid = normalizeOperations([
      operation('release', {
        type: 'UNASSIGN',
        shift_id: shifts.morning.id,
        employee_id: 'emp-a',
      }),
      operation('claim', {
        type: 'ASSIGN',
        shift_id: shifts.morning.id,
        employee_id: 'emp-b',
      }),
    ], baseState);
    const atomics = [
      ...valid.atomics.get('release')!,
      ...valid.atomics.get('claim')!,
    ];

    const applied = applyAtomics(atomics, state);

    expect(applied.applied).toEqual(['release', 'claim']);
    expect(applied.failed).toEqual([]);
    expect(state.shift_assignments.get(shifts.morning.id)).toBe('emp-b');
    expect(getEmployeeDelta(
      'emp-a',
      [shifts.morning],
      state,
    )).toEqual({
      added: [],
      removed: [shifts.morning],
    });

    const occupiedState = buildInitialState(baseState);
    const impossibleAtomic: AtomicOperation = {
      atomic_id: 'bad:atom:0',
      parent_operation_id: 'bad',
      type: 'ADD_EMPLOYEE_SHIFT',
      employee_id: 'emp-b',
      shift: shifts.morning,
      sequence_index: 0,
    };

    const failed = applyAtomics([impossibleAtomic], occupiedState);

    expect(failed.applied).toEqual([]);
    expect(failed.failed[0]).toMatchObject({ op_id: 'bad' });
    expect(occupiedState.shift_assignments.get(shifts.morning.id)).toBe('emp-a');
    expect(occupiedState.employee_shifts.get('emp-b')).toEqual([]);
  });

  it('combines structural, cycle, simulation and compliance conflicts deterministically', () => {
    const operations = [
      operation('contention-a', {
        type: 'ASSIGN',
        shift_id: shifts.overlap.id,
        employee_id: 'emp-a',
      }),
      operation('contention-b', {
        type: 'ASSIGN',
        shift_id: shifts.overlap.id,
        employee_id: 'emp-b',
      }),
    ];
    const normalized = normalizeOperations(operations, baseState);
    const graph = buildDependencyGraph(normalized);
    const blockingHit: V8Hit = {
      rule_id: 'R_TEST',
      rule_name: 'Test blocking rule',
      status: 'BLOCKING',
      summary: 'Blocked by test rule',
      details: 'Blocked by test rule',
      affected_shifts: [shifts.overlap.id],
      blocking: true,
    };
    const compliance: ComplianceValidationResult = {
      employee_results: [{
        employee_id: 'emp-a',
        result: {
          passed: false,
          overall_status: 'BLOCKING',
          hits: [blockingHit],
          consolidated_groups: [],
          conflict_pairs: [],
          delta_explanation: null,
          evaluated_shift_count: 1,
          evaluation_time_ms: 0,
        },
        changed_by_operations: ['contention-a'],
      }],
      blocking_operations: new Set(['contention-a']),
    };

    const result = detectConflicts(
      graph,
      ['cycle-op'],
      [{ op_id: 'failed-op', reason: 'precondition failed' }],
      compliance,
      operations,
      normalized.atomics,
    );

    expect(result.conflicts.map(conflict => conflict.type)).toEqual([
      'RESOURCE_CONTENTION',
      'DEPENDENCY_CYCLE',
      'LOGICAL_INCONSISTENCY',
      'COMPLIANCE_VIOLATION',
    ]);
    expect(result.blocked_operations).toEqual(new Set([
      'contention-a',
      'contention-b',
      'cycle-op',
      'failed-op',
    ]));
    expect(result.conflict_map.get('contention-a')).toHaveLength(2);
    expect(result.conflicts.map(conflict => conflict.conflict_id)).toEqual([
      'conflict:1',
      'conflict:2',
      'conflict:3',
      'conflict:4',
    ]);
  });
});

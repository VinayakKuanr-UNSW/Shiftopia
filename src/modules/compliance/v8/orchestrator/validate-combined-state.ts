/**
 * V8 Compliance Engine — Combined-State Validator
 */

import {
    V8EmpId,
    V8EmployeeContext,
    V8OrchestratorShift,
    V8ShiftId,
    V8OperationType,
    V8Stage,
    V8Config,
    V8OrchestratorResult,
} from './types';
import { runV8Orchestrator } from './index';

export interface V8CombinedStateInput {
    employee_id:       V8EmpId;
    employee_context:  V8EmployeeContext;
    original_shifts:   V8OrchestratorShift[];
    add_shifts:        V8OrchestratorShift[];
    remove_shift_ids:  V8ShiftId[];
    operation_type:    V8OperationType;
    stage:             V8Stage;
    config?:           Partial<V8Config>;
}

/**
 * Validates the FINAL combined schedule for one employee in V8.
 */
export function validateV8State(
    input: V8CombinedStateInput,
): V8OrchestratorResult {
    return runV8Orchestrator(
        {
            employee_id:       input.employee_id,
            employee_context:  input.employee_context,
            existing_shifts:   input.original_shifts,
            candidate_changes: {
                add_shifts:    input.add_shifts,
                remove_shifts: input.remove_shift_ids,
            },
            mode:              'SIMULATED',
            operation_type:    input.operation_type,
            stage:             input.stage,
            config:            input.config,
        },
        { stage: input.stage },
    );
}

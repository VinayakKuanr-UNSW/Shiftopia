/**
 * Batch Executor — Core Types
 *
 * All types for the batch compliance execution pipeline.
 * No UI logic, no DB assumptions.
 *
 * Operation flow:
 *   BatchInput
 *     → Normalizer  (validate + expand + deduplicate)
 *     → DepGraph    (dependency + conflict edges)
 *     → Ordering    (topological sort + priority)
 *     → Simulator   (in-memory state transitions)
 *     → ComplianceValidator (per-employee, reuses v2 engine)
 *     → ConflictDetector    (3-pass detection)
 *     → ConflictResolver    (4 strategies)
 *     → BatchResult
 */

import type {
    V8OrchestratorShift,
    V8ShiftId,
    V8EmpId,
    V8EmployeeContext,
    V8Hit,
    V8OrchestratorResult,
    V8Stage,
    V8Config,
} from '../types';

// =============================================================================
// OPERATION PAYLOADS
// =============================================================================

export type BatchV8OperationType = 'ASSIGN' | 'UNASSIGN' | 'BID_ACCEPT' | 'SWAP_APPROVE';

export interface AssignPayload {
    type:        'ASSIGN';
    shift_id:    V8ShiftId;
    employee_id: V8EmpId;
}

export interface UnassignPayload {
    type:        'UNASSIGN';
    shift_id:    V8ShiftId;
    employee_id: V8EmpId;
}

export interface BidAcceptPayload {
    type:                   'BID_ACCEPT';
    shift_id:               V8ShiftId;
    winning_employee_id:    V8EmpId;
    /** Tried in order when Strategy B (replacement) fires */
    fallback_employee_ids?: V8EmpId[];
}

export interface SwapApprovePayload {
    type:    'SWAP_APPROVE';
    party_a: { employee_id: V8EmpId; gives_shift_id: V8ShiftId };
    party_b: { employee_id: V8EmpId; gives_shift_id: V8ShiftId };
}

export type BatchOperationPayload =
    | AssignPayload
    | UnassignPayload
    | BidAcceptPayload
    | SwapApprovePayload;

// =============================================================================
// BATCH OPERATION
// =============================================================================

export interface BatchOperation {
    operation_id: string;
    type:         BatchV8OperationType;
    payload:      BatchOperationPayload;
    /** 1–100. Higher = more important when resolving conflicts */
    priority:     number;
    /** ISO8601. Tiebreaker within same priority */
    timestamp:    string;
}

// =============================================================================
// BASE STATE  (caller-supplied; no DB coupling)
// =============================================================================

export interface ShiftAssignment {
    shift_id:    V8ShiftId;
    employee_id: V8EmpId;
}

export interface EmployeeShiftHistory {
    employee_id:     V8EmpId;
    existing_shifts: V8OrchestratorShift[];
}

export interface BatchBaseState {
    shifts:                  V8OrchestratorShift[];
    current_assignments:     ShiftAssignment[];
    employees:               V8EmployeeContext[];
    employee_existing_shifts: EmployeeShiftHistory[];
}

// =============================================================================
// CONFIG
// =============================================================================

export type ResolutionStrategy = 'GREEDY' | 'REPLACEMENT' | 'ISOLATION' | 'SOLVER';

export interface BatchConfig {
    /**
     * GREEDY     — drop lowest-priority conflicting ops until set is clean
     * REPLACEMENT — try bid fallbacks before dropping (BID_ACCEPT only)
     * ISOLATION   — isolate problematic SWAPs without cascading
     * SOLVER      — greedy max-weight independent set (global optimum approx)
     */
    resolution_strategy:   ResolutionStrategy;
    allow_partial_commit:  boolean;     // default true — return valid subset, don't fail all
    max_resolution_passes: number;      // default 3 — prevent infinite resolution loops
    compliance_stage:      V8Stage;       // default 'DRAFT'
    compliance_config?:    Partial<V8Config>;
}

export const DEFAULT_BATCH_CONFIG: BatchConfig = {
    resolution_strategy:   'GREEDY',
    allow_partial_commit:  true,
    max_resolution_passes: 3,
    compliance_stage:      'DRAFT',
};

// =============================================================================
// INPUT CONTRACT
// =============================================================================

export interface BatchInput {
    base_state:  BatchBaseState;
    operations:  BatchOperation[];
    config?:     Partial<BatchConfig>;
}

// =============================================================================
// INTERNAL: ATOMIC OPERATIONS
// Composite operations (SWAP, BID_ACCEPT) expand to atomic ADD/REMOVE units.
// sequence_index ensures REMOVEs are applied before ADDs within a composite op.
// =============================================================================

export type AtomicOpType = 'ADD_EMPLOYEE_SHIFT' | 'REMOVE_EMPLOYEE_SHIFT';

export interface AtomicOperation {
    atomic_id:           string;
    parent_operation_id: string;
    type:                AtomicOpType;
    employee_id:         V8EmpId;
    shift:               V8OrchestratorShift;
    /** Lower index = earlier execution within parent op (removes < adds) */
    sequence_index:      number;
}

// =============================================================================
// INTERNAL: SIMULATED STATE
// =============================================================================

export interface SimulatedState {
    /** employee_id → their current schedule */
    employee_shifts:   Map<V8EmpId, V8OrchestratorShift[]>;
    /** shift_id → currently assigned employee (null = unassigned) */
    shift_assignments: Map<V8ShiftId, V8EmpId | null>;
}

// =============================================================================
// INTERNAL: OPERATION GRAPH
// =============================================================================

export type GraphEdgeType = 'DEPENDENCY' | 'CONFLICT';

export interface GraphEdge {
    from_op_id: string;
    to_op_id:   string;
    type:       GraphEdgeType;
    reason:     string;
}

export interface OperationGraph {
    nodes:        Map<string, BatchOperation>;
    edges:        GraphEdge[];
    /** op_id → set of ops that are WAITING ON this op to complete first */
    dependents:   Map<string, Set<string>>;
    /** op_id → set of ops THIS op must wait for */
    dependencies: Map<string, Set<string>>;
    /** op_id → set of ops it CONFLICTS with (bi-directional) */
    conflicts:    Map<string, Set<string>>;
}

// =============================================================================
// CONFLICT TYPES
// =============================================================================

export type BatchConflictType =
    | 'TIME_OVERLAP'          // Two ops produce overlapping shifts for same employee
    | 'RESOURCE_CONTENTION'   // Multiple ops claim the same shift for different employees
    | 'LOGICAL_INCONSISTENCY' // Precondition not met (shift not held, already assigned, etc.)
    | 'COMPLIANCE_VIOLATION'  // Compliance engine returns BLOCKING hit
    | 'DEPENDENCY_CYCLE'      // Circular dependency chain
    | 'DUPLICATE_OPERATION';  // Two semantically identical operations

export interface BatchConflict {
    conflict_id:      string;
    type:             BatchConflictType;
    operation_ids:    string[];
    description:      string;
    resolution_hint:  string;
    rule_hits:        V8Hit[];
    severity:         'BLOCKING' | 'WARNING';
}

// =============================================================================
// OUTPUT CONTRACT
// =============================================================================

export interface RejectedBatchOperation {
    operation_id:              string;
    reason:                    string;
    conflict_type:             BatchConflictType;
    rule_hits:                 V8Hit[];
    conflicting_operation_ids: string[];
}

export interface ModifiedBatchOperation {
    operation_id:        string;
    modification_type:   'BIDDER_REPLACED' | 'PAYLOAD_ADJUSTED';
    original_payload:    BatchOperationPayload;
    modified_payload:    BatchOperationPayload;
    modification_reason: string;
}

export type BatchComplianceStatus = 'CLEAN' | 'HAS_WARNINGS' | 'HAS_VIOLATIONS';

export interface FinalStateSummary {
    total_operations:   number;
    committed_count:    number;
    rejected_count:     number;
    modified_count:     number;
    affected_employees: V8EmpId[];
    affected_shifts:    V8ShiftId[];
    compliance_status:  BatchComplianceStatus;
}

export interface ExecutionLogEntry {
    sequence:     number;
    operation_id: string;
    action:       'APPLIED' | 'SKIPPED' | 'MODIFIED' | 'REJECTED';
    reason?:      string;
    elapsed_ms:   number;
}

export interface BatchResult {
    committed_operations: BatchOperation[];
    rejected_operations:  RejectedBatchOperation[];
    modified_operations:  ModifiedBatchOperation[];
    final_state_summary:  FinalStateSummary;
    execution_log:        ExecutionLogEntry[];
    evaluation_time_ms:   number;
}

// =============================================================================
// INTERNAL: NORMALIZER OUTPUT
// =============================================================================

export interface NormalizationResult {
    valid_operations:   BatchOperation[];
    invalid_operations: Array<{ operation_id: string; reason: string }>;
    /** op_id → expanded atomic operations (sorted by sequence_index) */
    atomics:            Map<string, AtomicOperation[]>;
}

// =============================================================================
// INTERNAL: SIMULATION RESULT
// =============================================================================

export interface SimulationResult {
    final_state:  SimulatedState;
    applied:      string[];
    failed:       Array<{ op_id: string; reason: string }>;
}

// =============================================================================
// INTERNAL: PER-EMPLOYEE COMPLIANCE RESULT
// =============================================================================

export interface EmployeeComplianceResult {
    employee_id:           V8EmpId;
    result:                V8OrchestratorResult;
    changed_by_operations: string[];
}

// =============================================================================
// INTERNAL: CONFLICT DETECTION OUTPUT
// =============================================================================

export interface ConflictDetectionResult {
    conflicts:           BatchConflict[];
    conflict_map:        Map<string, BatchConflict[]>;
    blocked_operations:  Set<string>;
}

// =============================================================================
// INTERNAL: RESOLUTION OUTPUT
// =============================================================================

export interface ConflictResolutionResult {
    committed_ops:  BatchOperation[];
    rejected_ops:   RejectedBatchOperation[];
    modified_ops:   ModifiedBatchOperation[];
    resolution_log: string[];
}

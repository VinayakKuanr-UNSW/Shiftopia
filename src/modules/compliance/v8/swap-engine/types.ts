/**
 * V8 Compliance Engine — Swap Engine Types
 */

import { V8Status, V8Shift } from '../types';

export interface V8SwapParty {
    employee_id:           string;
    name:                  string;
    hypothetical_schedule: V8Shift[];
    received_shift:        V8Shift;
    given_shift:           V8Shift;
}

export interface V8SwapScenario {
    partyA: V8SwapParty;
    partyB: V8SwapParty;
}

export interface V8SwapViolation {
    id:            string;
    name:          string;
    employee_id:   string;
    status:        V8Status;
    summary:       string;
    details:       string;
    blocking:      boolean;
}

export interface V8SwapResult {
    feasible:       boolean;
    violations:     V8SwapViolation[];
    warnings:       V8SwapViolation[];
    all_results:    V8SwapViolation[];
    solve_time_ms:  number;
}

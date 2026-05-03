/**
 * V8 Compliance Engine — Unified Entry Point
 * 
 * The single source of truth for all roster compliance, 
 * auditing, and swap feasibility logic in Shiftopia.
 */

export { v8Engine } from './engine';
export * from './types';
export * from './metadata';

// Transmission Adapters (Bridges)
export { runV8Compliance as runV8LegacyBridge } from './adapters/v1-to-v8';
export { runV8ComplexBridge } from './adapters/v2-to-v8';

// Orchestration & Solving
export { runV8Orchestrator } from './orchestrator/index';
export { V8SwapEngine }      from './swap-engine/constraint-engine';
export { applyV8Simulation } from './orchestrator/simulation';

// Eligibility & Validation
export { isV8Eligible, checkV8AvailabilityOnly } from './orchestrator/eligibility';
export { validateV8State }                       from './orchestrator/validate-combined-state';

// Metadata Registry
export { V8_RULE_METADATA } from './metadata';

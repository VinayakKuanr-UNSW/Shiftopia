/**
 * Typed error hierarchy for all RPC and API failures.
 *
 * Design principles:
 * - Every error has a machine-readable `code` — never parse error strings
 * - Compliance failures carry the full `violations` array — no string splitting
 * - State transition errors carry `from` + `action` — debuggable in telemetry
 * - All errors extend `AppError` so a single catch clause handles all cases
 */

export type RPCErrorCode =
  | 'RPC_NETWORK'       // Transport / network failure
  | 'RPC_VALIDATION'    // Response didn't match Zod schema
  | 'AUTH_REQUIRED'     // Not authenticated
  | 'PERMISSION_DENIED' // Authenticated but not authorised
  | 'NOT_FOUND'         // Resource doesn't exist
  | 'STATE_TRANSITION'  // Invalid state transition attempted
  | 'COMPLIANCE'        // Hard compliance violation (blocks save)
  | 'CONFLICT'          // Optimistic-lock / version conflict
  | 'VALIDATION'        // Client-side input validation failed
  | 'UNKNOWN';          // Unclassified — should never be used in new code

export interface StructuredError {
  code: RPCErrorCode;
  message: string;
  rpcName?: string;
  details?: Record<string, unknown>;
  violations?: string[];
}

// ── Base error ─────────────────────────────────────────────────────────────

export class AppError extends Error {
  readonly code: RPCErrorCode;
  readonly rpcName?: string;
  readonly details?: Record<string, unknown>;
  readonly violations?: string[];

  constructor(structured: StructuredError) {
    super(structured.message);
    this.name = 'AppError';
    this.code = structured.code;
    this.rpcName = structured.rpcName;
    this.details = structured.details;
    this.violations = structured.violations;
    // Preserve stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// ── Specialised errors ────────────────────────────────────────────────────

/** Hard compliance violation — blocks saving the shift */
export class ComplianceError extends AppError {
  constructor(violations: string[], rpcName?: string) {
    super({
      code: 'COMPLIANCE',
      message: `Compliance check failed: ${violations.join('; ')}`,
      rpcName,
      violations,
    });
    this.name = 'ComplianceError';
  }
}

/** Attempted a state transition not allowed by the spec */
export class StateTransitionError extends AppError {
  constructor(fromState: string, action: string, reason?: string) {
    super({
      code: 'STATE_TRANSITION',
      message: reason ?? `Cannot perform '${action}' from state '${fromState}'`,
      details: { from: fromState, action },
    });
    this.name = 'StateTransitionError';
  }
}

/** User is not authenticated */
export class AuthenticationError extends AppError {
  constructor() {
    super({ code: 'AUTH_REQUIRED', message: 'Authentication required. Please sign in.' });
    this.name = 'AuthenticationError';
  }
}

/** User is authenticated but lacks permission */
export class PermissionError extends AppError {
  constructor(action: string) {
    super({
      code: 'PERMISSION_DENIED',
      message: `You do not have permission to perform: ${action}`,
      details: { action },
    });
    this.name = 'PermissionError';
  }
}

/** Optimistic lock conflict — another actor updated the record */
export class ConflictError extends AppError {
  constructor(resourceType: string, id: string) {
    super({
      code: 'CONFLICT',
      message: `${resourceType} was modified by another user. Please refresh and try again.`,
      details: { resourceType, id },
    });
    this.name = 'ConflictError';
  }
}

// ── Type guards ────────────────────────────────────────────────────────────

export const isAppError = (e: unknown): e is AppError =>
  e instanceof AppError;

export const isComplianceError = (e: unknown): e is ComplianceError =>
  e instanceof ComplianceError;

export const isStateTransitionError = (e: unknown): e is StateTransitionError =>
  e instanceof StateTransitionError;

export const isAuthError = (e: unknown): e is AuthenticationError =>
  e instanceof AuthenticationError;

/** Coerce any thrown value into an AppError for safe handling */
export function toAppError(e: unknown, rpcName?: string): AppError {
  if (isAppError(e)) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new AppError({ code: 'UNKNOWN', message, rpcName });
}

/**
 * Roster Projection Engine — Public API
 *
 * Import from this barrel in all application code.
 * Do NOT import projectors or utils directly from their sub-paths.
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  GroupColorSet,
  ProjectedShift,
  ProjectionStats,
  SubGroupStats,
  GroupStats,
  ProjectedSubGroup,
  ProjectedGroup,
  GroupProjection,
  ProjectedRole,
  ProjectedLevel,
  RolesProjection,
  ProjectedEmployee,
  PeopleProjection,
  ProjectedEvent,
  EventsProjection,
  RoleRecord,
  LevelRecord,
  EmployeeRecord,
  EventRecord,
  ProjectionInput,
  ProjectionResult,
} from './types';

// ── Constants (needed by view components for colour lookups) ──────────────────
export {
  GROUP_COLORS,
  UNASSIGNED_COLORS,
  GROUP_DISPLAY_NAMES,
  ALL_GROUP_TYPES,
  UNASSIGNED_BUCKET_ID,
  levelColorClass,
  dicebearUrl,
} from './constants';

// ── Projectors (for unit tests and advanced consumers) ────────────────────────
export { projectGroup }  from './projectors/group.projector';
export { projectPeople } from './projectors/people.projector';
export { projectEvents } from './projectors/events.projector';
export { projectRoles }  from './projectors/roles.projector';

// ── Utility functions ─────────────────────────────────────────────────────────
export {
  parseTimeToMinutes,
  grossMinutes,
  netMinutesFromShift,
  formatMinutes,
  minutesToHours,
} from './utils/duration';

export {
  estimateShiftCost,
  estimateCostFromShift,
  formatCost,
} from './utils/cost';

export {
  coverageHealth,
  coverageVariant,
} from './utils/coverage';
export type { CoverageHealth } from './utils/coverage';

export { applyAdvancedFilters } from './utils/filters';

// ── Internal shared (not typically needed outside this directory) ──────────────
export { buildStats } from './projectors/shared';

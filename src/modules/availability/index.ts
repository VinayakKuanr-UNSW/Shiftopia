/**
 * Availability Module - Public API
 *
 * Export only the essential public interfaces:
 * - Page component
 * - Screen component (for direct use)
 * - Pane components (for custom layouts)
 * - Hooks (if needed externally)
 * - Types (if needed externally)
 */

// ============================================================================
// PAGES
// ============================================================================

export { default as AvailabilityPage } from './pages/AvailabilityPage';

// ============================================================================
// SCREEN & PANES (for custom layouts)
// ============================================================================

export { AvailabilityScreen } from './ui/AvailabilityScreen';
export type { AvailabilityScreenProps } from './ui/AvailabilityScreen';

export { CalendarPane, LogsPane, ConfigurePane } from './ui/panes';
export type { CalendarPaneProps, LogsPaneProps, ConfigurePaneProps } from './ui/panes';

// ============================================================================
// HOOKS (for external use)
// ============================================================================

export { useAvailability } from './state/useAvailability';
export type { UseAvailabilityOptions, UseAvailabilityResult } from './state/useAvailability';

export { useAvailabilityEditing } from './state/useAvailabilityEditing';
export type {
  EditMode,
  EditState,
  UseAvailabilityEditingResult,
} from './state/useAvailabilityEditing';

// ============================================================================
// TYPES (for external use)
// ============================================================================

export type {
  AvailabilityRule,
  AvailabilitySlot,
  AvailabilityFormPayload,
  RepeatType,
} from './model/availability.types';

// ============================================================================
// SERVICE LAYER (for advanced external use)
// ============================================================================

export {
  createAvailabilityFromForm,
  batchCreateAvailabilityRules,
  editAvailabilityRule,
  replaceAvailabilityInRange,
  deleteAvailability,
  fetchAvailabilityRules,
} from './api/availability.service';

// ============================================================================
// VALIDATION (for external use)
// ============================================================================

export {
  validateAvailabilityForm,
  validateDateRange,
  validateTimeRange,
  translateDatabaseError,
} from './utils/validation.utils';

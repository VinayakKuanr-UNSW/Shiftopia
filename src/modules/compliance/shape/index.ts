/**
 * Shift Shape Compliance — Public API
 *
 * Employee-free, synchronous validation of a shift's intrinsic shape.
 * Runs at shift CREATION; see ./types.ts for the layering rationale.
 */

export { evaluateShiftShape, requiredMinEngagementMinutes, mealBreakWindow } from './evaluate';

export type {
    ShapeResult,
    ShapeHit,
    ShapeEmploymentTarget,
} from './types';

export { DEFAULT_SHAPE_CONFIG } from './types';

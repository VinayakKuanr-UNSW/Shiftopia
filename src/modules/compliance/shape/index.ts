/**
 * Shift Shape Compliance — Public API
 *
 * Employee-free, synchronous validation of a shift's intrinsic shape.
 * Runs at shift CREATION; see ./types.ts for the layering rationale.
 */

export { evaluateShiftShape, requiredMinEngagementMinutes } from './evaluate';

export type {
    ShapeInput,
    ShapeResult,
    ShapeHit,
    ShapeStatus,
    ShapeConfig,
    ShapeEmploymentTarget,
    ShapeRuleId,
} from './types';

export { DEFAULT_SHAPE_CONFIG, DAY_TYPED_SHAPE_RULES } from './types';

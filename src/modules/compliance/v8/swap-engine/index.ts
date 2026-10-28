// Guards (pre-flight API-level checks)
export { runSwapGuards, SwapGuardError } from './guards';

// Chain swap scenario

// Types

// Scenario builder

// Constraint engine + adapter

// Unified scenario entry point (use when scenario is already built)

// Utilities: scenario window + schedule aggregation

// Services: concurrency revalidation before commit

// Public evaluator for swaps (2-party)
export { swapEvaluator } from './swap-evaluator';

// Public evaluator for single-party actions: add / assign / bid


/**
 * Cost estimation utilities - Dispatcher
 * 
 * Separates Security logic from Standard ICC Sydney logic.
 * Security: Building Services -> Security
 */

// Re-export everything except the ones we override
export * from './cost/types';
export * from './cost/constants';


// Re-export these names explicitly to avoid any 'export *' ambiguity
export {
  estimateDetailedCostFromShift,
  extractLevel,
} from './cost/index';

// Multi-argument wrapper for backward compatibility - OVERRIDES the one in index.ts


export function formatCost(amount: number, currency = 'AUD'): string {
  return amount.toLocaleString('en-AU', {
    style:    'currency',
    currency,
    maximumFractionDigits: 2,
  });
}

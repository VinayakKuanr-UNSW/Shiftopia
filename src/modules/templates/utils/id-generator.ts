// src/modules/templates/utils/id-generator.ts
// Temporary ID utilities for local state management

/**
 * Generate a temporary ID for new entities before they are persisted.
 * Format: `{prefix}-{timestamp}-{random}`
 */
export function generateTempId(prefix: string = 'temp'): string {
    const cleanPrefix = prefix.startsWith('temp') ? prefix : `temp-${prefix}`;
    return `${cleanPrefix}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}


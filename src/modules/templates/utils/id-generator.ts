// src/modules/templates/utils/id-generator.ts
// Temporary ID utilities for local state management

/**
 * Generate a temporary ID for new entities before they are persisted.
 * Format: `{prefix}-{timestamp}-{random}`
 */
export function generateTempId(prefix: string = 'temp'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Check if an ID is a temporary (client-generated) ID.
 */
export function isTempId(id: string | number): boolean {
    return String(id).startsWith('temp-');
}

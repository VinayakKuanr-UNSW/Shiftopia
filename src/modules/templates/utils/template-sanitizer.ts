// src/modules/templates/utils/template-sanitizer.ts
// Input sanitization utilities for templates

/**
 * Sanitize a generic string input.
 * Removes angle brackets and limits length.
 */
export function sanitizeString(input: string | undefined | null): string {
    if (!input) return '';
    return input.trim().replace(/[<>]/g, '').slice(0, 500);
}

/**
 * Sanitize a template name.
 * Removes dangerous characters and limits length.
 */
export function sanitizeTemplateName(name: string): string {
    return name
        .trim()
        .replace(/[<>\\]/g, '')
        .slice(0, 100);
}

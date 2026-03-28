// ============================================================
// BROADCASTS DTO — transformation and normalisation helpers
// Location: src/modules/broadcasts/api/broadcasts.dto.ts
// ============================================================

import type { BroadcastFileType } from '../model/broadcast.types';

// ── camelCase / snakeCase converters ─────────────────────────────────────────

export function toCamelCase<T>(obj: any): T {
    if (obj === null || obj === undefined) return obj;

    if (Array.isArray(obj)) {
        return obj.map((item) => toCamelCase(item)) as T;
    }

    if (typeof obj === 'object' && obj !== null) {
        return Object.keys(obj).reduce((result, key) => {
            const camelKey = key.replace(/_([a-z])/g, (_, letter) =>
                letter.toUpperCase()
            );
            result[camelKey] = toCamelCase(obj[key]);
            return result;
        }, {} as any) as T;
    }

    return obj;
}

export function toSnakeCase(obj: any): any {
    if (obj === null || obj === undefined) return obj;

    if (Array.isArray(obj)) {
        return obj.map((item) => toSnakeCase(item));
    }

    if (typeof obj === 'object' && obj !== null) {
        return Object.keys(obj).reduce((result, key) => {
            const snakeKey = key.replace(
                /[A-Z]/g,
                (letter) => `_${letter.toLowerCase()}`
            );
            result[snakeKey] = toSnakeCase(obj[key]);
            return result;
        }, {} as any);
    }

    return obj;
}

// ── File-type helper ──────────────────────────────────────────────────────────

export function getFileTypeFromName(fileName: string): BroadcastFileType {
    const ext = fileName.toLowerCase().split('.').pop() || '';
    const typeMap: Record<string, BroadcastFileType> = {
        pdf: 'pdf',
        png: 'image',
        jpg: 'image',
        jpeg: 'image',
        gif: 'image',
        webp: 'image',
        doc: 'document',
        docx: 'document',
        txt: 'document',
        rtf: 'document',
        xls: 'spreadsheet',
        xlsx: 'spreadsheet',
        csv: 'spreadsheet',
    };
    return typeMap[ext] || 'other';
}

// ── Row normalisers ───────────────────────────────────────────────────────────

/**
 * Normalise a raw broadcast row that was joined with profiles via
 * `profiles!author_id(id, first_name, last_name, email)`.
 * Returns the `author` shape expected by BroadcastWithDetails.
 */
export function normalizeAuthor(
    raw: any
): { id: string; name: string; email: string } | null {
    if (!raw) return null;
    return {
        id: raw.id,
        name: `${raw.first_name} ${raw.last_name}`,
        email: raw.email,
    };
}

/**
 * Normalise a raw broadcast row that was joined using the relational select
 * pattern (with nested profiles and broadcast_attachments).
 * Produces the full BroadcastWithDetails shape before the final toCamelCase pass.
 */
export function normalizeBroadcastRow(
    broadcast: any,
    authorRole: string,
    extras: {
        isRead?: boolean;
        acknowledgementStatus?: string;
        acknowledgedAt?: string;
    } = {}
): any {
    const rawAuthor = broadcast.profiles ?? broadcast.employees ?? null;
    return {
        ...broadcast,
        author: normalizeAuthor(rawAuthor),
        authorRole,
        attachments: broadcast.broadcast_attachments ?? [],
        isRead: extras.isRead,
        acknowledgementStatus: extras.acknowledgementStatus,
        acknowledgedAt: extras.acknowledgedAt,
    };
}

// ── Legacy class (kept for backwards-compat — do NOT expand) ──────────────────

/** @deprecated Legacy class — exists only for backwards compatibility. */
export class BroadcastDbClient {
    // intentionally empty — superseded by the functional service objects
}

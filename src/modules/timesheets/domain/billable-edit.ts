/**
 * Shared, pure rules for validating a billable-time edit and detecting variance
 * from the roster. Used by BOTH the desktop timesheet row and the mobile card so
 * the two edit surfaces can never drift (mirrors why billable-time.ts exists).
 *
 *  • validateBillableEdit   — format, 5-min granularity, end-after-start, break
 *                             bounds; plus which sides the manager changed and
 *                             which changed sides vary beyond the ±grace.
 *  • billableVarianceVsRoster — variance of the already-resolved billable window
 *                             (any source) vs the roster, for the approval gate.
 */

import { VARIANCE_GRACE_MIN } from './variance-reasons';

const DAY_MIN = 24 * 60;

/** "HH:MM"/"HH:MM:SS" → minutes since midnight, or null. */
export function parseHHMM(t: string | null | undefined): number | null {
    const m = (t || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    return Number.isNaN(h) || Number.isNaN(mi) ? null : h * 60 + mi;
}

/** Auto-format a bare "1600" / "930" into "16:00" / "09:30"; leave others as-is. */
export function formatTimeStr(t: string): string {
    if (/^\d{3,4}$/.test(t)) {
        return t.length === 3 ? `0${t.slice(0, 1)}:${t.slice(1)}` : `${t.slice(0, 2)}:${t.slice(2)}`;
    }
    return t;
}

export interface BillableEditInput {
    editedStart: string;
    editedEnd: string;
    initialStart: string;
    initialEnd: string;
    scheduledStart: string;
    scheduledEnd: string;
    unpaidBreakMinutes: number;
}

export interface BillableEditResult {
    ok: boolean;
    /** validation message when !ok */
    error?: string;
    normalizedStart: string;
    normalizedEnd: string;
    startChanged: boolean;
    endChanged: boolean;
    /** a CHANGED side that now varies from roster beyond ±grace → reason required */
    needArrivalReason: boolean;
    needDepartureReason: boolean;
}

export function validateBillableEdit(p: BillableEditInput): BillableEditResult {
    const normalizedStart = formatTimeStr(p.editedStart);
    const normalizedEnd = formatTimeStr(p.editedEnd);
    const sMins = normalizedStart ? parseHHMM(normalizedStart) : null;
    const eMins = normalizedEnd ? parseHHMM(normalizedEnd) : null;

    const base = {
        normalizedStart, normalizedEnd,
        startChanged: false, endChanged: false,
        needArrivalReason: false, needDepartureReason: false,
    };
    const fail = (error: string): BillableEditResult => ({ ok: false, error, ...base });

    // Each filled side must parse.
    if ((normalizedStart && sMins === null) || (normalizedEnd && eMins === null)) {
        return fail('Invalid time format. Use HH:MM or HHMM.');
    }
    // 5-minute granularity (F6).
    if ((sMins !== null && sMins % 5 !== 0) || (eMins !== null && eMins % 5 !== 0)) {
        return fail('Billable times must be on 5-minute increments.');
    }
    // End must be after start (overnight-aware).
    let grossMins: number | null = null;
    if (sMins !== null && eMins !== null) {
        const end = eMins <= sMins ? eMins + DAY_MIN : eMins;
        grossMins = end - sMins;
        if (grossMins <= 0) return fail('Adjusted end time must be after start time.');
    }
    // Unpaid break bounds.
    if (p.unpaidBreakMinutes < 0) return fail('Unpaid break cannot be negative.');
    if (grossMins !== null && p.unpaidBreakMinutes > grossMins) {
        return fail('Unpaid break exceeds the shift length.');
    }

    const norm = (t: string) => formatTimeStr(t).slice(0, 5);
    const startChanged = norm(normalizedStart) !== norm(p.initialStart);
    const endChanged = norm(normalizedEnd) !== norm(p.initialEnd);

    const { arrival, departure } = varianceOf(sMins, eMins, p.scheduledStart, p.scheduledEnd);

    return {
        ok: true,
        normalizedStart, normalizedEnd,
        startChanged, endChanged,
        needArrivalReason: !!(startChanged && normalizedStart && arrival),
        needDepartureReason: !!(endChanged && normalizedEnd && departure),
    };
}

/** Variance (beyond ±grace) of a resolved billable window vs the roster. */
export function billableVarianceVsRoster(
    billableStart: string | null | undefined,
    billableEnd: string | null | undefined,
    scheduledStart: string,
    scheduledEnd: string,
): { arrival: boolean; departure: boolean } {
    return varianceOf(parseHHMM(billableStart), parseHHMM(billableEnd), scheduledStart, scheduledEnd);
}

function varianceOf(
    startMins: number | null,
    endMins: number | null,
    scheduledStart: string,
    scheduledEnd: string,
): { arrival: boolean; departure: boolean } {
    const schedS = parseHHMM(scheduledStart);
    const schedE = parseHHMM(scheduledEnd);
    const arrDiff = startMins !== null && schedS !== null ? Math.abs(startMins - schedS) : 0;
    // Wrap-safe distance so overnight ends don't false-trigger.
    const depRaw = endMins !== null && schedE !== null ? Math.abs((endMins % DAY_MIN) - schedE) : 0;
    const depDiff = Math.min(depRaw, DAY_MIN - depRaw);
    return {
        arrival: startMins !== null && arrDiff > VARIANCE_GRACE_MIN,
        departure: endMins !== null && depDiff > VARIANCE_GRACE_MIN,
    };
}

import { ComplianceRule, ComplianceResult, ComplianceCheckInput, ShiftTimeRange } from '../types';
import { doShiftsOverlap, parseTimeToMinutes, minutesToHours } from '../utils';

// Local helper to calculate overlap
function calculateOverlapMinutes(shift1: ShiftTimeRange, shift2: ShiftTimeRange): number {
    const start1 = parseTimeToMinutes(shift1.start_time);
    let end1 = parseTimeToMinutes(shift1.end_time);
    if (end1 <= start1) end1 += 24 * 60; // Cross-midnight helper

    const start2 = parseTimeToMinutes(shift2.start_time);
    let end2 = parseTimeToMinutes(shift2.end_time);
    if (end2 <= start2) end2 += 24 * 60;

    // TODO: This assumes overlapping shifts are on the same effective day relative to their start times
    // For exact multi-day overlap, rely on doShiftsOverlap which handles split days.
    // This simplified calculation works for the typical case where doShiftsOverlap has already found a conflict.

    // We align them based on the fact they overlap.
    const overlapStart = Math.max(start1, start2);
    const overlapEnd = Math.min(end1, end2);
    return Math.max(0, overlapEnd - overlapStart);
}

function getDurationMinutes(shift: ShiftTimeRange): number {
    const start = parseTimeToMinutes(shift.start_time);
    let end = parseTimeToMinutes(shift.end_time);
    if (end <= start) end += 24 * 60;
    return end - start;
}

export const NoOverlapRule: ComplianceRule = {
    id: 'NO_OVERLAP',
    name: 'No Overlapping Shifts',
    description: 'Ensure the candidate shift does not overlap with any existing shifts.',
    appliesTo: ['add', 'assign', 'swap', 'bid'],
    blocking: true, // Overlaps are hard blockers
    evaluate(input: ComplianceCheckInput): ComplianceResult {
        const { candidate_shift, existing_shifts } = input;

        // Find overlapping shift
        const overlappingShift = existing_shifts.find(existing =>
            doShiftsOverlap(candidate_shift, existing)
        );

        if (overlappingShift) {
            const overlapMinutes = calculateOverlapMinutes(candidate_shift, overlappingShift);
            const candidateMinutes = getDurationMinutes(candidate_shift);
            const existingMinutes = getDurationMinutes(overlappingShift);

            return {
                rule_id: 'NO_OVERLAP',
                rule_name: 'No Overlapping Shifts',
                status: 'fail',
                summary: `Overlaps with shift on ${overlappingShift.shift_date}`,
                details: `Candidate shift overlaps with existing shift: ${overlappingShift.start_time} - ${overlappingShift.end_time} on ${overlappingShift.shift_date}`,
                calculation: {
                    existing_hours: minutesToHours(existingMinutes),
                    candidate_hours: minutesToHours(candidateMinutes),
                    total_hours: minutesToHours(overlapMinutes), // Using total_hours for overlap duration
                    limit: 0,
                    existing_shift_id: overlappingShift.shift_id,
                    existing_start_time: overlappingShift.start_time,
                    existing_end_time: overlappingShift.end_time,
                    candidate_start_time: candidate_shift.start_time,
                    candidate_end_time: candidate_shift.end_time
                },
                blocking: true
            };
        }

        return {
            rule_id: 'NO_OVERLAP',
            rule_name: 'No Overlapping Shifts',
            status: 'pass',
            summary: 'No overlapping shifts found',
            details: 'Candidate shift does not overlap with any existing shifts.',
            calculation: {
                existing_hours: 0,
                candidate_hours: 0,
                total_hours: 0,
                limit: 0
            },
            blocking: true
        };
    }
};

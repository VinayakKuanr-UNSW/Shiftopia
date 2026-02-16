/**
 * Bucket View Utilities
 * Groups identical shifts (same time, subgroup, date) into visual buckets.
 * Buckets are runtime-only — no database changes.
 */

export interface BucketStats {
    total: number;
    assignedCount: number;
    unassignedCount: number;
    lockedCount: number;
    publishedCount: number;
    draftCount: number;
}

export interface ShiftBucket {
    /** Unique key: `${startTime}-${endTime}-${date}-${subGroupName}` */
    key: string;
    startTime: string;
    endTime: string;
    date: string;
    subGroupName: string;
    /** Child shift IDs in this bucket */
    shiftIds: string[];
    stats: BucketStats;
}

/**
 * Derives the bucket publish status from stats.
 */
export function getBucketPublishStatus(stats: BucketStats): 'Draft' | 'Partially Published' | 'Published' {
    if (stats.publishedCount === 0) return 'Draft';
    if (stats.publishedCount === stats.total) return 'Published';
    return 'Partially Published';
}

/**
 * Build a bucket key from shift properties.
 */
export function buildBucketKey(startTime: string, endTime: string, date: string, subGroupName: string): string {
    return `${startTime}-${endTime}-${date}-${subGroupName}`;
}

/**
 * Group an array of ShiftDisplay objects into buckets.
 * Shifts with the same start_time, end_time, date, and subgroup are merged.
 *
 * @param shifts Array of shift display objects (must all be from the same subgroup+date cell)
 * @param subGroupName The subgroup these shifts belong to
 * @param date The date key (YYYY-MM-DD)
 * @param isLockedFn Function to check if a shift is locked
 * @returns Array of ShiftBucket objects, sorted by startTime
 */
export function groupShiftsIntoBuckets<T extends {
    id: string;
    startTime: string;
    endTime: string;
    isPublished: boolean;
    isDraft: boolean;
    assignedEmployeeId?: string | null;
    isLocked?: boolean;
}>(
    shifts: T[],
    subGroupName: string,
    date: string,
): ShiftBucket[] {
    const bucketMap = new Map<string, ShiftBucket>();

    for (const shift of shifts) {
        const key = buildBucketKey(shift.startTime, shift.endTime, date, subGroupName);

        if (!bucketMap.has(key)) {
            bucketMap.set(key, {
                key,
                startTime: shift.startTime,
                endTime: shift.endTime,
                date,
                subGroupName,
                shiftIds: [],
                stats: {
                    total: 0,
                    assignedCount: 0,
                    unassignedCount: 0,
                    lockedCount: 0,
                    publishedCount: 0,
                    draftCount: 0,
                },
            });
        }

        const bucket = bucketMap.get(key)!;
        bucket.shiftIds.push(shift.id);
        bucket.stats.total++;

        if (shift.assignedEmployeeId) {
            bucket.stats.assignedCount++;
        } else {
            bucket.stats.unassignedCount++;
        }

        if (shift.isLocked) {
            bucket.stats.lockedCount++;
        }

        if (shift.isPublished) {
            bucket.stats.publishedCount++;
        }

        if (shift.isDraft) {
            bucket.stats.draftCount++;
        }
    }

    // Sort buckets by start time
    return Array.from(bucketMap.values()).sort((a, b) =>
        a.startTime.localeCompare(b.startTime)
    );
}

/**
 * Can Publish Roster Policy
 * Domain layer - determines if a roster can be published
 */




/** cl 38.1 — rosters should be published at least this many days before they start. */
const ROSTER_NOTICE_DAYS = 7;

/**
 * cl 38.1: "A copy of the roster will be provided to Team Members a minimum
 * of seven (7) days in advance of the roster commencement date." Audit
 * H-4: this had zero notice-period logic anywhere. Advisory (never
 * blocking) because the clause itself contemplates emergencies, and a hard
 * block here would stop legitimate last-minute operational rostering — the
 * same WARNING-not-BLOCKING posture the V8 compliance rules use for
 * procedural (as opposed to hard numeric-cap) requirements.
 */
export function checkRosterPublishNotice(
    rosterStartDate: string,
    publishDate: Date = new Date(),
): string | undefined {
    const start = new Date(rosterStartDate + 'T00:00:00');
    if (Number.isNaN(start.getTime())) return undefined;
    const daysNotice = Math.floor((start.getTime() - publishDate.getTime()) / 86_400_000);
    if (daysNotice < ROSTER_NOTICE_DAYS) {
        return daysNotice < 0
            ? `This roster starts in the past relative to the publish date — cl 38.1 requires ${ROSTER_NOTICE_DAYS} days' notice.`
            : `Only ${daysNotice} day${daysNotice === 1 ? '' : 's'}' notice before this roster starts — cl 38.1 requires ${ROSTER_NOTICE_DAYS} days. Publishing is still allowed (e.g. for a genuine operational need), but confirm this is intentional.`;
    }
    return undefined;
}


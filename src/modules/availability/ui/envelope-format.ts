/**
 * Presentation formatters for the contract ordinary-hours envelope.
 *
 * Shared by `ContractBasisBanner` (shown to PT) and the Full-Time card on
 * `AvailabilityPage` (shown to FT). They describe the same contract field to two
 * different audiences, so they must render it identically — a span that reads
 * "6am–6pm" in one place and "06:00:00–18:00:00" in the other looks like two
 * different pieces of data.
 *
 * Kept out of `domain/contract-basis.ts` on purpose: that module is pure domain
 * logic with no presentation opinions, and these are entirely presentation.
 */

const ISO_DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** '06:00:00' -> '6am'. Falls back to the raw value if it is not a time. */
export function formatEnvelopeTime(value: string | null): string {
    if (!value) return '';
    const [h, m] = value.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return value;
    const suffix = h < 12 ? 'am' : 'pm';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

/** [1,2,3,4,5] -> 'Mon–Fri'; [1,3,5] -> 'Mon, Wed, Fri'; null -> 'any day'. */
export function formatEnvelopeDays(days: number[] | null): string {
    if (!days || days.length === 0 || days.length === 7) return 'any day';
    const sorted = [...days].sort((a, b) => a - b);
    const isRun = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
    const label = (d: number) => ISO_DAY_LABELS[d - 1] ?? String(d);
    if (isRun && sorted.length > 2) return `${label(sorted[0])}–${label(sorted[sorted.length - 1])}`;
    return sorted.map(label).join(', ');
}

/**
 * The days clause as a sentence fragment, empty when the envelope applies on all
 * seven — ", Mon–Fri" reads naturally appended to a span, whereas ", any day"
 * only adds noise.
 */
export function formatEnvelopeDaysClause(days: number[] | null): string {
    const label = formatEnvelopeDays(days);
    return label === 'any day' ? '' : `, ${label}`;
}

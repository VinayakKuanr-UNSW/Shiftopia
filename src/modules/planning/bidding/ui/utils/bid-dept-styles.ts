// Department badge / card classes — uses CSS defined in index.css (light + dark adaptive)

export function getDeptColor(groupType: string | null | undefined, dept: string): string {
    const gt = (groupType || '').toLowerCase();
    const d = (dept || '').toLowerCase();
    if (gt === 'convention_centre' || d.includes('convention'))
        return 'dept-badge-convention';
    if (gt === 'exhibition_centre' || d.includes('exhibition'))
        return 'dept-badge-exhibition';
    if (gt === 'theatre' || d.includes('theatre'))
        return 'dept-badge-theatre';
    if (gt === 'the_cutaway' || gt.includes('cutaway') || d.includes('cutaway'))
        return 'dept-badge-cutaway';
    return 'dept-badge-default';
}

export function getCardBg(groupType: string | null | undefined, dept: string): string {
    const base = 'dept-card-base';
    const gt = (groupType || '').toLowerCase();
    const d = (dept || '').toLowerCase();
    if (gt === 'convention_centre' || d.includes('convention'))
        return `${base} dept-card-convention`;
    if (gt === 'exhibition_centre' || d.includes('exhibition'))
        return `${base} dept-card-exhibition`;
    if (gt === 'theatre' || d.includes('theatre'))
        return `${base} dept-card-theatre`;
    if (gt === 'the_cutaway' || gt.includes('cutaway') || d.includes('cutaway'))
        return `${base} dept-card-glass-cutaway`;
    return `${base} dept-card-default`;
}

export function getRowClass(groupType: string | null | undefined, dept: string): string {
    const gt = (groupType || '').toLowerCase();
    const d = (dept || '').toLowerCase();
    if (gt === 'convention_centre' || d.includes('convention'))
        return 'dept-row-convention';
    if (gt === 'exhibition_centre' || d.includes('exhibition'))
        return 'dept-row-exhibition';
    if (gt === 'theatre' || d.includes('theatre'))
        return 'dept-row-theatre';
    if (gt === 'the_cutaway' || gt.includes('cutaway') || d.includes('cutaway'))
        return 'dept-row-cutaway';
    return 'dept-row-default';
}

// Inline Tailwind classes for mobile list rows (div-based, not table-row).
// Pairs a soft bg tint with a 4px left stripe — same palette as `getRowClass`.
export type DeptAccent = {
    bg: string;
    stripe: string;
    dot: string;
};

export function getDeptAccent(groupType: string | null | undefined, dept: string): DeptAccent {
    const d = (dept || '').toLowerCase();
    const gt = (groupType || '').toLowerCase();
    if (gt === 'convention_centre' || d.includes('convention')) {
        return {
            bg: 'bg-blue-500/[0.06] dark:bg-blue-500/[0.10]',
            stripe: 'border-l-blue-500/70 dark:border-l-blue-400/70',
            dot: 'bg-blue-500',
        };
    }
    if (gt === 'exhibition_centre' || d.includes('exhibition')) {
        return {
            bg: 'bg-emerald-500/[0.06] dark:bg-emerald-500/[0.10]',
            stripe: 'border-l-emerald-500/70 dark:border-l-emerald-400/70',
            dot: 'bg-emerald-500',
        };
    }
    if (gt === 'theatre' || d.includes('theatre')) {
        return {
            bg: 'bg-rose-500/[0.06] dark:bg-rose-500/[0.10]',
            stripe: 'border-l-rose-500/70 dark:border-l-rose-400/70',
            dot: 'bg-rose-500',
        };
    }
    if (gt === 'the_cutaway' || gt.includes('cutaway') || d.includes('cutaway')) {
        return {
            bg: 'bg-amber-500/[0.06] dark:bg-amber-500/[0.10]',
            stripe: 'border-l-amber-500/70 dark:border-l-amber-400/70',
            dot: 'bg-amber-500',
        };
    }
    return {
        bg: 'bg-slate-500/[0.04] dark:bg-slate-500/[0.08]',
        stripe: 'border-l-slate-400/60 dark:border-l-slate-500/60',
        dot: 'bg-slate-400',
    };
}

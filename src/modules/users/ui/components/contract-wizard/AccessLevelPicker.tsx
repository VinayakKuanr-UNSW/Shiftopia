import React from 'react';
import { Check, Lightbulb } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';
import { Button } from '@/modules/core/ui/primitives/button';
import { ACCESS_LEVELS, ACCESS_LEVEL_CONFIG, accessReach } from '@/platform/auth/constants';
import type { AccessLevel } from '@/platform/auth/types';

interface AccessLevelPickerProps {
    /** Null: the saved contract records no access; nothing is selected. */
    value: AccessLevel | null;
    onChange: (level: AccessLevel) => void;
    /** The contract's place: access reaches from here. */
    place: { organization?: string | null; department?: string | null; subDepartment?: string | null };
    /** The chosen role leads a team, so Team Lead is worth suggesting. */
    roleLeadsTeam?: boolean;
}

/** Roles whose title says they lead people. A suggestion only — nothing is set for you. */
export const roleLeadsTeam = (roleName: string | null | undefined): boolean =>
    !!roleName && /\b(team leader|team lead|supervisor)\b/i.test(roleName);

/**
 * The access a contract gives. It reaches the contract's own place, so the
 * picker says where: "Event Setup", "All of Events", "Everywhere".
 */
export const AccessLevelPicker: React.FC<AccessLevelPickerProps> = ({ value, onChange, place, roleLeadsTeam: leads }) => (
    <fieldset className="w-full text-left">
        <legend className={cn(text.label, 'mb-1.5')}>Access</legend>
        {value === null && (
            <p className={cn(text.caption, 'mb-2')}>
                No access is recorded on this contract. It stays that way unless you pick one.
            </p>
        )}
        {leads && value === 'alpha' && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                <Lightbulb className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                <span className={cn(text.caption, 'flex-1 min-w-[12rem]')}>
                    This role leads a team. Team Lead lets them see the team&apos;s timesheets.
                </span>
                <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => onChange('beta')}>
                    Use Team Lead
                </Button>
            </div>
        )}
        <div role="radiogroup" aria-label="Access" className="rounded-xl border border-border divide-y divide-border overflow-hidden">
            {ACCESS_LEVELS.map((level) => {
                const c = ACCESS_LEVEL_CONFIG[level];
                const selected = value === level;
                return (
                    <button
                        key={level}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onChange(level)}
                        className={cn(
                            'w-full flex items-start gap-3 px-3.5 py-2.5 text-left transition-colors min-h-11',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                            selected ? 'bg-primary/5' : 'bg-card hover:bg-muted/40',
                        )}
                    >
                        <span
                            className={cn(
                                'mt-0.5 h-4 w-4 shrink-0 rounded-full border flex items-center justify-center',
                                selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                            )}
                            aria-hidden="true"
                        >
                            {selected && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                                <span className={text.body}>{c.label}</span>
                                <span className={text.subtle}>{accessReach(level, place)}</span>
                            </span>
                            <span className={cn(text.caption, 'block')}>{c.description}</span>
                        </span>
                    </button>
                );
            })}
        </div>
    </fieldset>
);


import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { text } from '@/modules/core/ui/typography';
import { EMPLOYMENT_TYPES, type EmploymentType } from '../../../hooks/useContractWizardForm';

interface Step1EmploymentTypeProps {
    value: string;
    onSelect: (type: EmploymentType) => void;
}

/**
 * The four EBA employment types (cl 12.1). Each one decides the contracted
 * hours and the remuneration options that follow in step 3.
 */
const TYPES: Record<EmploymentType, { hours: string; pay: string; clause: string }> = {
    'Full-Time': {
        hours: '38 hours a week',
        pay: 'Salaried, or Level 0–7',
        clause: 'cl 12.2',
    },
    'Part-Time': {
        hours: 'Agreed hours, under 38 a week',
        pay: 'Level 0–7, or salaried pro-rata',
        clause: 'cl 12.3',
    },
    'Flexible Part-Time': {
        hours: '624–1,976 hours a year',
        pay: 'Level 0–7',
        clause: 'cl 12.4',
    },
    Casual: {
        hours: 'No contracted hours',
        pay: 'Level 0–7, casual rate',
        clause: 'cl 12.5',
    },
};

/** Step 1 — the employment type. */
export const Step1EmploymentType: React.FC<Step1EmploymentTypeProps> = ({ value, onSelect }) => (
    <fieldset className="max-w-2xl mx-auto w-full">
        <legend className={cn(text.heading, 'mb-1')}>Employment type</legend>
        <p className={cn(text.bodyMuted, 'mb-4')}>
            Sets the contracted hours and how the position can be paid.
        </p>
        <div role="radiogroup" aria-label="Employment type" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {EMPLOYMENT_TYPES.map((type) => {
                const t = TYPES[type];
                const selected = value === type;
                return (
                    <button
                        key={type}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onSelect(type)}
                        className={cn(
                            'relative text-left rounded-xl border p-4 min-h-[5.5rem] transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                            selected ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/40',
                        )}
                    >
                        <span className="flex items-center justify-between gap-2">
                            <span className={text.heading}>{type}</span>
                            {selected && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
                        </span>
                        <span className={cn(text.caption, 'block mt-1')}>{t.hours}</span>
                        <span className={cn(text.caption, 'block')}>{t.pay}</span>
                        <span className={cn(text.subtle, 'block mt-1.5')}>EBA {t.clause}</span>
                    </button>
                );
            })}
        </div>
    </fieldset>
);


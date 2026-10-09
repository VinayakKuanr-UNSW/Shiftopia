import React, { useMemo } from 'react';
import { CommandSelector } from '../CommandSelector';
import { RemunerationLevelBadge } from '../RemunerationLevelBadge';
import { Layers } from 'lucide-react';
import { isLevelInBand, hasBand, type RoleBand } from '../../../domain/contractPayTerms';

export interface RemunerationLevelRow {
    level_number: number;
    level_name: string;
    description?: string | null;
}

export interface RemunerationLevelPickerProps {
    value: number | '';
    onChange: (level: number) => void;
    levels: RemunerationLevelRow[];
    disabled?: boolean;
    /** Only these levels are offered (annualised Security: Levels 3–6). */
    allowedLevels?: readonly number[];
    /** The role's EA band — levels inside it are marked. */
    band?: RoleBand | null;
    /** What a level pays for this engagement, e.g. "$44.92/h", from the EA rate on the start date. */
    rateFor?: (level: number) => string | null;
}

/**
 * Level 0–7 picker. Independent of the role — the level is a term of the
 * contract — but the role's EA band is marked, and each level shows what it
 * pays for this engagement.
 */
export const RemunerationLevelPicker: React.FC<RemunerationLevelPickerProps> = ({
    value, onChange, levels, disabled, allowedLevels, band, rateFor,
}) => {
    const options = useMemo(() => {
        const showBand = hasBand(band);
        return [...levels]
            .filter(l => !allowedLevels || allowedLevels.includes(l.level_number))
            .sort((a, b) => a.level_number - b.level_number)
            .map(l => {
                const subtitle = [
                    rateFor?.(l.level_number) ?? null,
                    showBand && isLevelInBand(l.level_number, band) ? 'in role range' : null,
                ].filter(Boolean).join(' · ');
                return {
                    id: String(l.level_number),
                    name: l.level_name,
                    subtitle: subtitle || undefined,
                    icon: <RemunerationLevelBadge level={l.level_number} />,
                };
            });
    }, [levels, allowedLevels, band, rateFor]);

    return (
        <CommandSelector
            label="Remuneration Level"
            placeholder="Select level"
            value={value === '' ? '' : String(value)}
            onValueChange={(val) => onChange(Number(val))}
            options={options}
            disabled={disabled}
            icon={<Layers className="w-5 h-5 text-primary" />}
        />
    );
};

export default RemunerationLevelPicker;

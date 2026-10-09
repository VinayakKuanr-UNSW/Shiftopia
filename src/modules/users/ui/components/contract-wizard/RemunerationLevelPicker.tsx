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
}

/**
 * Level 0–7 picker. Independent of the role — the level is a term of the
 * contract — but the role's EA band is marked. No rates: money is shown in
 * Gross Pay alone.
 */
export const RemunerationLevelPicker: React.FC<RemunerationLevelPickerProps> = ({
    value, onChange, levels, disabled, allowedLevels, band,
}) => {
    const options = useMemo(() => {
        const showBand = hasBand(band);
        return [...levels]
            .filter(l => !allowedLevels || allowedLevels.includes(l.level_number))
            .sort((a, b) => a.level_number - b.level_number)
            .map(l => ({
                id: String(l.level_number),
                name: l.level_name,
                subtitle: showBand && isLevelInBand(l.level_number, band) ? 'in role range' : undefined,
                icon: <RemunerationLevelBadge level={l.level_number} />,
            }));
    }, [levels, allowedLevels, band]);

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

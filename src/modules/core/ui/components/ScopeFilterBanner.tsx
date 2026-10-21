// src/modules/core/ui/components/ScopeFilterBanner.tsx
// Unified scope filter banner component for page integration (Phase 5)

import React from 'react';
import { PersonalScopeFilter } from './PersonalScopeFilter';
import type { ScopeLevel } from './GlobalScopeFilter';
import { ManagerialScopeFilter } from './ManagerialScopeFilter';
import type { ScopeSelection } from '@/platform/auth/types';
import { useScopeFilter, type ScopeMode } from '@/platform/auth/useScopeFilter';
import { cn } from '@/modules/core/lib/utils';

interface ScopeFilterBannerProps {
    /** Personal (contracted sub-departments), managerial or Timesheets scope */
    mode: ScopeMode;
    /** Called when scope selection changes */
    onScopeChange: (scope: ScopeSelection) => void;
    /** If true, the filter is fully locked (gamma) and should be hidden */
    hidden?: boolean;
    multiSelect?: boolean;
    /**
     * Levels forced to a single choice even in multi-select mode. Only
     * meaningful for `personal`; see `GlobalScopeFilterProps`.
     */
    singleSelectLevels?: ScopeLevel[];
    /** Additional CSS classes */
    className?: string;
    compactOnMobile?: boolean;
}

/**
 * ScopeFilterBanner
 *
 * Thin wrapper that renders the correct scope filter component based on mode.
 * Renders nothing when this mode's tree is empty — no contract reaches a place —
 * so the page shows no empty wrapper.
 */
export const ScopeFilterBanner: React.FC<ScopeFilterBannerProps> = ({
    mode,
    onScopeChange,
    hidden = false,
    multiSelect,
    singleSelectLevels,
    className,
    compactOnMobile = false,
}) => {
    // The same tree the filter offers. It used to ask for a Type X (personal) or
    // Type Y (managerial) certificate instead, and alpha contracts mint no
    // certificate, so most employees never saw their personal filter.
    const { scopeTree } = useScopeFilter(mode);

    if (hidden) return null;
    if (!scopeTree?.organizations?.length) return null;

    // Default multiSelect based on mode if not provided
    // Personal mode defaults to multi-select (true)
    // Managerial mode defaults to single-select (false) per business rules
    const effectiveMultiSelect = multiSelect !== undefined
        ? multiSelect
        : mode === 'personal';

    return (
        <div className={cn(
            'relative z-50 w-full',
            className
        )}>
            {mode === 'personal' ? (
                <PersonalScopeFilter
                    onScopeChange={onScopeChange}
                    multiSelect={effectiveMultiSelect}
                    singleSelectLevels={singleSelectLevels}
                />
            ) : (
                <ManagerialScopeFilter
                    mode={mode}
                    onScopeChange={onScopeChange}
                    multiSelect={effectiveMultiSelect}
                    compactOnMobile={compactOnMobile}
                />
            )}
        </div>
    );
};

export default ScopeFilterBanner;

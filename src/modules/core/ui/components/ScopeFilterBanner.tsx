// src/modules/core/ui/components/ScopeFilterBanner.tsx
// Unified scope filter banner component for page integration (Phase 5)

import React, { useContext } from 'react';
import { AuthContext } from '@/platform/auth/AuthProvider';
import { PersonalScopeFilter } from './PersonalScopeFilter';
import { ManagerialScopeFilter } from './ManagerialScopeFilter';
import type { ScopeSelection } from '@/platform/auth/types';
import type { ScopeMode } from '@/platform/auth/useScopeFilter';
import { cn } from '@/modules/core/lib/utils';

interface ScopeFilterBannerProps {
    /** Whether this page uses personal (Type X) or managerial (Type Y) scope */
    mode: ScopeMode;
    /** Called when scope selection changes */
    onScopeChange: (scope: ScopeSelection) => void;
    /** If true, the filter is fully locked (gamma) and should be hidden */
    hidden?: boolean;
    multiSelect?: boolean;
    /** Additional CSS classes */
    className?: string;
}

/**
 * ScopeFilterBanner
 *
 * Thin wrapper that renders the correct scope filter component based on mode.
 * Checks auth context to avoid rendering an empty wrapper when no certs exist.
 */
export const ScopeFilterBanner: React.FC<ScopeFilterBannerProps> = ({
    mode,
    onScopeChange,
    hidden = false,
    multiSelect,
    className,
}) => {
    const context = useContext(AuthContext);
    const { permissionObject } = context || {};

    if (hidden) return null;

    // Don't render the wrapper if the child component would return null
    if (mode === 'personal' && (!permissionObject || !permissionObject.typeX?.length)) {
        return null;
    }
    if (mode === 'managerial' && (!permissionObject?.typeY || !permissionObject?.allowed_scope_tree)) {
        return null;
    }

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
                />
            ) : (
                <ManagerialScopeFilter
                    onScopeChange={onScopeChange}
                    multiSelect={effectiveMultiSelect}
                />
            )}
        </div>
    );
};

export default ScopeFilterBanner;


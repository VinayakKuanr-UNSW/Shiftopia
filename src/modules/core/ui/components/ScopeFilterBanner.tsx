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
    multiSelect = true,
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

    return (
        <div className={cn(
            'relative z-30 rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-md p-1',
            className
        )}>
            {mode === 'personal' ? (
                <PersonalScopeFilter
                    onScopeChange={onScopeChange}
                    multiSelect={multiSelect}
                />
            ) : (
                <ManagerialScopeFilter
                    onScopeChange={onScopeChange}
                    multiSelect={multiSelect}
                />
            )}
        </div>
    );
};

export default ScopeFilterBanner;


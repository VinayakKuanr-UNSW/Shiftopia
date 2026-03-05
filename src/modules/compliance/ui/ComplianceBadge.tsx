/**
 * Compliance Badge Component
 * 
 * Visual indicator showing compliance check status.
 * Clickable to open detailed modal.
 */

import React from 'react';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { ComplianceCheckResult } from '../types';
import { cn } from '@/modules/core/lib/utils';

interface ComplianceBadgeProps {
    result: ComplianceCheckResult | null;
    loading?: boolean;
    onClick?: () => void;
    size?: 'sm' | 'md' | 'lg';
    showLabel?: boolean;
}

export function ComplianceBadge({
    result,
    loading = false,
    onClick,
    size = 'md',
    showLabel = true
}: ComplianceBadgeProps) {
    if (loading) {
        return (
            <div className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5',
                'bg-muted text-muted-foreground border border-border'
            )}>
                <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                {showLabel && <span className="text-sm">Checking...</span>}
            </div>
        );
    }

    if (!result) {
        return null;
    }

    const sizeClasses = {
        sm: 'px-2 py-1 text-xs gap-1',
        md: 'px-3 py-1.5 text-sm gap-1.5',
        lg: 'px-4 py-2 text-base gap-2'
    };

    const iconSizes = {
        sm: 'w-3 h-3',
        md: 'w-4 h-4',
        lg: 'w-5 h-5'
    };

    // Determine status
    if (!result.passed) {
        return (
            <button
                onClick={onClick}
                className={cn(
                    'inline-flex items-center rounded-full font-medium transition-all',
                    'bg-red-500/10 text-red-600 border border-red-500/20 dark:bg-red-500/20 dark:text-red-400 dark:border-red-500/30',
                    'hover:bg-red-500/20 hover:border-red-500/40 dark:hover:bg-red-500/30 dark:hover:border-red-500/50',
                    sizeClasses[size],
                    onClick && 'cursor-pointer'
                )}
            >
                <XCircle className={iconSizes[size]} />
                {showLabel && <span>Compliance failed</span>}
            </button>
        );
    }

    if (result.hasWarnings) {
        return (
            <button
                onClick={onClick}
                className={cn(
                    'inline-flex items-center rounded-full font-medium transition-all',
                    'bg-amber-500/10 text-amber-600 border border-amber-500/20 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/30',
                    'hover:bg-amber-500/20 hover:border-amber-500/40 dark:hover:bg-amber-500/30 dark:hover:border-amber-500/50',
                    sizeClasses[size],
                    onClick && 'cursor-pointer'
                )}
            >
                <AlertTriangle className={iconSizes[size]} />
                {showLabel && <span>Warning</span>}
            </button>
        );
    }

    return (
        <button
            onClick={onClick}
            className={cn(
                'inline-flex items-center rounded-full font-medium transition-all',
                'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-500/30',
                'hover:bg-emerald-500/20 hover:border-emerald-500/40 dark:hover:bg-emerald-500/30 dark:hover:border-emerald-500/50',
                sizeClasses[size],
                onClick && 'cursor-pointer'
            )}
        >
            <CheckCircle className={iconSizes[size]} />
            {showLabel && <span>Compliance passed</span>}
        </button>
    );
}

export default ComplianceBadge;

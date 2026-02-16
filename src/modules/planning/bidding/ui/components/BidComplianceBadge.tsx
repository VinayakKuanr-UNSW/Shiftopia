/**
 * BidComplianceBadge
 * 
 * Displays the compliance status for a bid-eligible shift.
 * Shows pass/warning/fail status with X/Y checks passed count.
 */

import React from 'react';
import { Shield, ShieldAlert, ShieldCheck, Loader2 } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';

interface BidComplianceBadgeProps {
    status: 'pass' | 'warning' | 'fail' | 'loading' | 'unknown';
    passedCount: number;
    totalCount: number;
    className?: string;
}

export function BidComplianceBadge({
    status,
    passedCount,
    totalCount,
    className,
}: BidComplianceBadgeProps) {
    const config = {
        pass: {
            icon: ShieldCheck,
            bg: 'bg-emerald-500/20',
            border: 'border-emerald-500/40',
            text: 'text-emerald-400',
            label: 'Compliant',
        },
        warning: {
            icon: ShieldAlert,
            bg: 'bg-amber-500/20',
            border: 'border-amber-500/40',
            text: 'text-amber-400',
            label: 'Warning',
        },
        fail: {
            icon: ShieldAlert,
            bg: 'bg-red-500/20',
            border: 'border-red-500/40',
            text: 'text-red-400',
            label: 'Ineligible',
        },
        loading: {
            icon: Loader2,
            bg: 'bg-white/10',
            border: 'border-white/20',
            text: 'text-white/60',
            label: 'Checking...',
        },
        unknown: {
            icon: Shield,
            bg: 'bg-white/10',
            border: 'border-white/20',
            text: 'text-white/40',
            label: 'Not Checked',
        },
    };

    const { icon: Icon, bg, border, text, label } = config[status];

    return (
        <div
            className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs',
                bg,
                border,
                className
            )}
        >
            <Icon
                className={cn(
                    'w-3.5 h-3.5',
                    text,
                    status === 'loading' && 'animate-spin'
                )}
            />
            <span className={cn('font-medium', text)}>
                {status === 'loading' || status === 'unknown'
                    ? label
                    : `${passedCount}/${totalCount} Passed`}
            </span>
        </div>
    );
}

export default BidComplianceBadge;

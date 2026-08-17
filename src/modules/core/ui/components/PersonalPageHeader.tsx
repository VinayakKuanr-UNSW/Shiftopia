import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { formatInTimezone, SYDNEY_TZ } from '@/modules/core/lib/date.utils';
import { LucideIcon } from 'lucide-react';
import { ScopeFilterBanner } from './ScopeFilterBanner';
import { ScopeSelection } from '@/platform/auth/types';
import { itemVariants } from '../motion/presets';
import { cn } from '@/modules/core/lib/utils';

interface PersonalPageHeaderProps {
    title: string;
    Icon: LucideIcon;
    scope?: ScopeSelection;
    setScope?: (scope: ScopeSelection) => void;
    isGammaLocked?: boolean;
    mode?: 'personal' | 'managerial';
    multiSelect?: boolean;
    rightActions?: React.ReactNode;
    className?: string;
    /** Opt-in denser mobile treatment for control-heavy planner pages. */
    compactOnMobile?: boolean;
}

/**
 * PersonalPageHeader
 * 
 * A unified header component for all personal application pages.
 * Includes Page Title, Icon, Live Digital Clock, and Scope Filter.
 */
export const PersonalPageHeader: React.FC<PersonalPageHeaderProps> = ({
    title,
    Icon,
    scope,
    setScope,
    isGammaLocked = false,
    mode = 'personal',
    multiSelect,
    rightActions,
    className,
    compactOnMobile = false,
}) => {
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const showFilter = !isGammaLocked && scope && setScope;

    return (
        <div className={className}>
            {/* ── Title & Clock ── */}
            <motion.div
                variants={itemVariants}
                className={cn(
                    'flex items-start justify-between shrink-0 mb-4',
                    compactOnMobile && 'items-center mb-2 sm:items-start sm:mb-4',
                )}
            >
                <div>
                    <div className="flex items-center gap-2 mb-0.5">
                        <Icon
                            className={cn(
                                'h-6 w-6 text-primary',
                                compactOnMobile && 'h-5 w-5 sm:h-6 sm:w-6',
                            )}
                            aria-hidden="true"
                        />
                        <h1 className={cn(
                            'text-3xl font-black tracking-tight text-slate-900 dark:text-foreground',
                            compactOnMobile && 'text-xl leading-none sm:text-3xl sm:leading-normal',
                        )}>
                            {title}
                        </h1>
                    </div>
                </div>
                {/* Merge note: the responsive `compactOnMobile` sizing comes from the
                    mobile work, but the clock itself stays on formatInTimezone/SYDNEY_TZ
                    and keeps its role="timer" label. The mobile branch had switched to
                    date-fns `format`, which renders the VIEWER's local time — wrong for
                    a venue clock, and a silent regression outside Australia. */}
                <div className={cn('flex flex-col items-end gap-2', compactOnMobile && 'gap-0 sm:gap-2')}>
                    <div
                        className="text-right"
                        role="timer"
                        aria-live="off"
                        aria-label={`Current venue time: ${formatInTimezone(now, SYDNEY_TZ, 'HH:mm:ss')}`}
                    >
                        <div className={cn('flex items-center justify-end gap-3 mb-1', compactOnMobile && 'mb-0 sm:mb-1')}>
                            <p className={cn(
                                'text-3xl font-mono font-black tabular-nums leading-none text-slate-800 dark:text-foreground',
                                compactOnMobile && 'text-xl sm:text-3xl',
                            )}>
                                {formatInTimezone(now, SYDNEY_TZ, 'HH:mm')}
                            </p>
                        </div>
                        <p className={cn(
                            'text-xs font-mono tabular-nums text-slate-400 dark:text-muted-foreground',
                            compactOnMobile && 'hidden sm:block',
                        )} aria-hidden="true">
                            :{formatInTimezone(now, SYDNEY_TZ, 'ss')}
                        </p>
                    </div>
                    {rightActions && (
                        <div className="flex items-center gap-2">
                            {rightActions}
                        </div>
                    )}
                </div>
            </motion.div>

            {/* ── Global Scope Filter ── */}
            {showFilter && (
                <motion.div
                    variants={itemVariants}
                    className={cn('flex-shrink-0 mb-4', compactOnMobile && 'mb-0 sm:mb-4')}
                >
                    <ScopeFilterBanner
                        mode={mode}
                        onScopeChange={setScope}
                        multiSelect={multiSelect}
                        hidden={isGammaLocked}
                        compactOnMobile={compactOnMobile}
                    />
                </motion.div>
            )}
        </div>
    );
};

export default PersonalPageHeader;

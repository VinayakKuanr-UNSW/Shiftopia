import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { ScopeFilterBanner } from './ScopeFilterBanner';
import { ScopeSelection } from '@/platform/auth/types';
import { itemVariants } from '../motion/presets';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

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
    isGammaLocked = true,
    mode = 'personal',
    multiSelect,
    rightActions,
    className,
}) => {
    const [now, setNow] = useState(new Date());
    const { isDark } = useTheme();

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const showFilter = !isGammaLocked && scope && setScope;

    return (
        <div className={className}>
            {/* ── Title & Clock ── */}
            <motion.div variants={itemVariants} className="flex items-start justify-between shrink-0 mb-4">
                <div>
                    <div className="flex items-center gap-2 mb-0.5">
                        <Icon className="h-6 w-6 text-primary" />
                        <h1 className={cn(
                            "text-3xl font-black tracking-tight",
                            isDark ? "text-foreground" : "text-slate-900"
                        )}>
                            {title}
                        </h1>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <div className="text-right">
                        <div className="flex items-center justify-end gap-3 mb-1">
                            <p className={cn(
                                "text-3xl font-mono font-black tabular-nums leading-none",
                                isDark ? "text-foreground" : "text-slate-800"
                            )}>
                                {format(now, 'HH:mm')}
                            </p>
                        </div>
                        <p className={cn(
                            "text-xs font-mono tabular-nums",
                            isDark ? "text-muted-foreground" : "text-slate-400"
                        )}>
                            :{format(now, 'ss')}
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
                <motion.div variants={itemVariants} className="flex-shrink-0 mb-4">
                    <ScopeFilterBanner
                        mode={mode}
                        onScopeChange={setScope}
                        multiSelect={multiSelect}
                        hidden={isGammaLocked}
                    />
                </motion.div>
            )}
        </div>
    );
};

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { ScopeFilterBanner } from './ScopeFilterBanner';
import { ScopeSelection } from '@/platform/auth/types';
import { itemVariants } from '../motion/presets';

interface PersonalPageHeaderProps {
    title: string;
    Icon: LucideIcon;
    scope?: ScopeSelection;
    setScope?: (scope: ScopeSelection) => void;
    isGammaLocked?: boolean;
    mode?: 'personal' | 'managerial';
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
    rightActions,
    className,
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
            <motion.div variants={itemVariants} className="flex items-start justify-between shrink-0 mb-4">
                <div>
                    <div className="flex items-center gap-2 mb-0.5">
                        <Icon className="h-5 w-5 text-primary" />
                        <h1 className="text-2xl font-black tracking-tight text-foreground">{title}</h1>
                    </div>
                    <p className="text-sm text-muted-foreground">{format(now, 'EEEE, d MMMM yyyy')}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <div className="text-right">
                        <p className="text-3xl font-mono font-black text-foreground tabular-nums leading-none">
                            {format(now, 'HH:mm')}
                        </p>
                        <p className="text-xs font-mono text-muted-foreground tabular-nums">
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
                <motion.div variants={itemVariants} className="flex-shrink-0">
                    <ScopeFilterBanner
                        mode={mode}
                        onScopeChange={setScope}
                        hidden={isGammaLocked}
                    />
                </motion.div>
            )}
        </div>
    );
};

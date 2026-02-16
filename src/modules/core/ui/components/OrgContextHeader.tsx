/**
 * OrgContextHeader
 *
 * A distinctive, globally-reusable component that displays the organizational
 * hierarchy context derived from the user's ACCESS CERTIFICATE (not position contract).
 *
 * Access Level Rules:
 * - epsilon: org=locked, dept=SELECT, subdept=SELECT (from selected dept)
 * - delta:   org=locked, dept=locked, subdept=SELECT (from locked dept)
 * - gamma:   org=locked, dept=locked, subdept=locked
 * - beta:    org=locked, dept=locked, subdept=locked
 * - alpha:   org=locked, dept=locked, subdept=locked
 *
 * Design Direction: Geometric minimalism with bold accent colors
 */

import React from 'react';
import { motion } from 'framer-motion';
import { Building2, Layers, GitBranch, Lock, ChevronDown, Shield, ChevronRight, Loader2 } from 'lucide-react';
import { useOrgSelection } from '@/modules/core/contexts/OrgSelectionContext';
import { cn } from '@/modules/core/lib/utils';

interface OrgContextHeaderProps {
    /** Optional title to display alongside the context */
    title?: string;
    /** Optional subtitle/description */
    subtitle?: string;
    /** Compact mode for tighter spaces */
    compact?: boolean;
    /** Custom className for the container */
    className?: string;
    /** Show the access level badge */
    showAccessLevel?: boolean;
}

const ACCESS_LEVEL_COLORS: Record<string, { bg: string; text: string; glow: string; border: string }> = {
    alpha: { bg: 'bg-slate-500/20', text: 'text-slate-300', glow: 'shadow-slate-500/20', border: 'border-slate-500/30' },
    beta: { bg: 'bg-emerald-500/20', text: 'text-emerald-300', glow: 'shadow-emerald-500/20', border: 'border-emerald-500/30' },
    gamma: { bg: 'bg-amber-500/20', text: 'text-amber-300', glow: 'shadow-amber-500/20', border: 'border-amber-500/30' },
    delta: { bg: 'bg-rose-500/20', text: 'text-rose-300', glow: 'shadow-rose-500/20', border: 'border-rose-500/30' },
    epsilon: { bg: 'bg-violet-500/20', text: 'text-violet-300', glow: 'shadow-violet-500/20', border: 'border-violet-500/30' },
};

const ACCESS_LEVEL_LABELS: Record<string, string> = {
    alpha: 'Team Member',
    beta: 'Team Lead',
    gamma: 'Supervisor',
    delta: 'Manager',
    epsilon: 'Global Admin',
};

export const OrgContextHeader: React.FC<OrgContextHeaderProps> = ({
    title,
    subtitle,
    compact = false,
    className,
    showAccessLevel = true,
}) => {
    const orgSelection = useOrgSelection();

    const {
        organizationId,
        organizationName,
        departmentId,
        departmentName,
        subDepartmentId,
        subDepartmentName,
        isDeptLocked,
        isSubDeptLocked,
        accessLevel,
        availableDepartments,
        availableSubDepartments,
        isLoadingDepartments,
        isLoadingSubDepartments,
        selectDepartment,
        selectSubDepartment,
    } = orgSelection;

    if (!organizationId) {
        return null;
    }

    const levelColors = ACCESS_LEVEL_COLORS[accessLevel || 'alpha'] || ACCESS_LEVEL_COLORS.alpha;

    const containerVariants = {
        hidden: { opacity: 0, y: -10 },
        visible: {
            opacity: 1,
            y: 0,
            transition: {
                duration: 0.4,
                ease: [0.25, 0.46, 0.45, 0.94],
                staggerChildren: 0.08,
            },
        },
    };

    const itemVariants = {
        hidden: { opacity: 0, x: -10 },
        visible: { opacity: 1, x: 0 },
    };

    // Locked hierarchy item (static display)
    const LockedItem: React.FC<{
        icon: React.ElementType;
        label: string;
        value: string;
        color: string;
        isLast?: boolean;
    }> = ({ icon: Icon, label, value, color, isLast }) => (
        <motion.div variants={itemVariants} className="flex items-center gap-2">
            <div className={cn(
                "relative flex items-center gap-2 px-3 py-1.5 rounded-lg border backdrop-blur-sm transition-all duration-300",
                "bg-gradient-to-br from-white/[0.03] to-transparent",
                "border-white/[0.08] hover:border-white/[0.15]",
                "group"
            )}>
                <div className={cn(
                    "absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full transition-all duration-300",
                    color.replace('text-', 'bg-'),
                    "group-hover:h-6"
                )} />

                <Icon className={cn("h-3.5 w-3.5", color)} />

                <div className="flex flex-col">
                    <span className="text-[9px] uppercase tracking-widest text-white/30 font-medium">
                        {label}
                    </span>
                    <span className={cn("text-sm font-semibold tracking-tight", color)}>
                        {value}
                    </span>
                </div>

                <Lock className="h-2.5 w-2.5 text-white/20 ml-1" />
            </div>

            {!isLast && (
                <ChevronRight className="h-3 w-3 text-white/20" />
            )}
        </motion.div>
    );

    // Selectable hierarchy item (dropdown)
    const SelectableItem: React.FC<{
        icon: React.ElementType;
        label: string;
        value: string | null;
        placeholder: string;
        color: string;
        options: { id: string; name: string }[];
        isLoading: boolean;
        onChange: (id: string | null) => void;
        isLast?: boolean;
    }> = ({ icon: Icon, label, value, placeholder, color, options, isLoading, onChange, isLast }) => (
        <motion.div variants={itemVariants} className="flex items-center gap-2">
            <div className={cn(
                "relative flex items-center gap-2 px-3 py-1.5 rounded-lg border backdrop-blur-sm transition-all duration-300",
                "bg-gradient-to-br from-violet-500/[0.05] to-transparent",
                "border-violet-500/30 hover:border-violet-500/50",
                "group"
            )}>
                <div className={cn(
                    "absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full transition-all duration-300",
                    "bg-violet-400",
                    "group-hover:h-6"
                )} />

                <Icon className="h-3.5 w-3.5 text-violet-400" />

                <div className="flex flex-col min-w-[120px]">
                    <span className="text-[9px] uppercase tracking-widest text-white/30 font-medium">
                        {label}
                    </span>
                    <div className="relative">
                        {isLoading ? (
                            <div className="flex items-center gap-1.5 text-sm text-violet-300">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Loading...
                            </div>
                        ) : (
                            <select
                                value={value || ''}
                                onChange={(e) => onChange(e.target.value || null)}
                                className={cn(
                                    "appearance-none bg-transparent text-sm font-semibold tracking-tight cursor-pointer",
                                    "focus:outline-none w-full pr-5",
                                    value ? color : "text-violet-300/60"
                                )}
                            >
                                <option value="" className="bg-slate-900 text-white/60">
                                    {placeholder}
                                </option>
                                {options.map((opt) => (
                                    <option key={opt.id} value={opt.id} className="bg-slate-900 text-white">
                                        {opt.name}
                                    </option>
                                ))}
                            </select>
                        )}
                        {!isLoading && (
                            <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 h-3 w-3 text-violet-400 pointer-events-none" />
                        )}
                    </div>
                </div>
            </div>

            {!isLast && (
                <ChevronRight className="h-3 w-3 text-white/20" />
            )}
        </motion.div>
    );

    if (compact) {
        return (
            <motion.div
                initial="hidden"
                animate="visible"
                variants={containerVariants}
                className={cn(
                    "flex items-center gap-2 text-xs flex-wrap",
                    className
                )}
            >
                <div className={cn(
                    "flex items-center gap-1.5 border rounded-lg px-2.5 py-1.5",
                    levelColors.bg,
                    levelColors.border
                )}>
                    <Building2 className="h-3 w-3 text-cyan-400" />
                    <span className="text-cyan-400 font-medium">
                        {organizationName}
                    </span>
                    <span className="text-white/20">/</span>

                    {isDeptLocked ? (
                        <span className="text-emerald-400 font-medium">
                            {departmentName || 'Unknown'}
                        </span>
                    ) : (
                        <select
                            value={departmentId || ''}
                            onChange={(e) => selectDepartment(e.target.value || null)}
                            className="appearance-none bg-transparent text-violet-400 font-medium cursor-pointer focus:outline-none pr-4"
                        >
                            <option value="" className="bg-slate-900">All Depts</option>
                            {availableDepartments.map(d => (
                                <option key={d.id} value={d.id} className="bg-slate-900">{d.name}</option>
                            ))}
                        </select>
                    )}

                    {(isDeptLocked || departmentId) && (
                        <>
                            <span className="text-white/20">/</span>
                            {isSubDeptLocked ? (
                                <span className="text-amber-400 font-medium">
                                    {subDepartmentName || 'Unknown'}
                                </span>
                            ) : (
                                <select
                                    value={subDepartmentId || ''}
                                    onChange={(e) => selectSubDepartment(e.target.value || null)}
                                    className="appearance-none bg-transparent text-violet-400 font-medium cursor-pointer focus:outline-none pr-4"
                                    disabled={!isDeptLocked && !departmentId}
                                >
                                    <option value="" className="bg-slate-900">All Subs</option>
                                    {availableSubDepartments.map(sd => (
                                        <option key={sd.id} value={sd.id} className="bg-slate-900">{sd.name}</option>
                                    ))}
                                </select>
                            )}
                        </>
                    )}

                    <Shield className={cn("h-2.5 w-2.5 ml-1", levelColors.text)} />
                </div>
            </motion.div>
        );
    }

    return (
        <motion.div
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            className={cn(
                "relative overflow-hidden rounded-xl border",
                levelColors.border,
                "bg-gradient-to-br from-white/[0.02] via-transparent to-white/[0.01]",
                "backdrop-blur-xl",
                className
            )}
        >
            {/* Decorative gradient accent */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/30 to-transparent" />

            <div className="px-5 py-4">
                {/* Title Row */}
                {(title || showAccessLevel) && (
                    <div className="flex items-center justify-between mb-4">
                        {title && (
                            <motion.div variants={itemVariants}>
                                <h2 className="text-lg font-bold text-white tracking-tight">
                                    {title}
                                </h2>
                                {subtitle && (
                                    <p className="text-xs text-white/40 mt-0.5">{subtitle}</p>
                                )}
                            </motion.div>
                        )}

                        {showAccessLevel && accessLevel && (
                            <motion.div
                                variants={itemVariants}
                                className={cn(
                                    "flex items-center gap-2 px-3 py-1.5 rounded-lg border",
                                    levelColors.bg,
                                    levelColors.border,
                                    `shadow-lg ${levelColors.glow}`
                                )}
                            >
                                <Shield className={cn("h-3.5 w-3.5", levelColors.text)} />
                                <span className={cn("text-xs font-bold uppercase tracking-wider", levelColors.text)}>
                                    {ACCESS_LEVEL_LABELS[accessLevel]}
                                </span>
                            </motion.div>
                        )}
                    </div>
                )}

                {/* Hierarchy Row */}
                <div className="flex items-center gap-2 flex-wrap">
                    {/* Organization - Always locked */}
                    <LockedItem
                        icon={Building2}
                        label="Organization"
                        value={organizationName || 'Organization'}
                        color="text-cyan-400"
                    />

                    {/* Department - Locked or Selectable based on access level */}
                    {isDeptLocked ? (
                        <LockedItem
                            icon={Layers}
                            label="Department"
                            value={departmentName || 'Unknown'}
                            color="text-emerald-400"
                            isLast={isSubDeptLocked}
                        />
                    ) : (
                        <SelectableItem
                            icon={Layers}
                            label="Department"
                            value={departmentId}
                            placeholder="All Departments"
                            color="text-emerald-400"
                            options={availableDepartments}
                            isLoading={isLoadingDepartments}
                            onChange={selectDepartment}
                        />
                    )}

                    {/* Sub-Department - Show if dept is selected/locked */}
                    {(isDeptLocked || departmentId) && (
                        isSubDeptLocked ? (
                            <LockedItem
                                icon={GitBranch}
                                label="Sub-Department"
                                value={subDepartmentName || 'Unknown'}
                                color="text-amber-400"
                                isLast
                            />
                        ) : (
                            <SelectableItem
                                icon={GitBranch}
                                label="Sub-Department"
                                value={subDepartmentId}
                                placeholder="All Sub-Depts"
                                color="text-amber-400"
                                options={availableSubDepartments}
                                isLoading={isLoadingSubDepartments}
                                onChange={selectSubDepartment}
                                isLast
                            />
                        )
                    )}
                </div>

                {/* Context Info */}
                <motion.div
                    variants={itemVariants}
                    className="mt-3 pt-3 border-t border-white/[0.04]"
                >
                    <p className="text-[10px] text-white/30 font-mono tracking-wide">
                        <span className={cn("font-bold", levelColors.text)}>ACCESS CERTIFICATE</span>
                        <span className="mx-2 text-white/20">|</span>
                        {accessLevel === 'epsilon' ? (
                            departmentId ? (
                                subDepartmentId ? (
                                    <span className="text-amber-300">Viewing {subDepartmentName}</span>
                                ) : (
                                    <span className="text-emerald-300">Select a sub-department to filter data</span>
                                )
                            ) : (
                                <span className="text-violet-300">Select a department to continue</span>
                            )
                        ) : accessLevel === 'delta' ? (
                            subDepartmentId ? (
                                <span className="text-amber-300">Viewing {subDepartmentName}</span>
                            ) : (
                                <span className="text-violet-300">Select a sub-department to filter data</span>
                            )
                        ) : (
                            <span className="text-amber-300">Access limited to {subDepartmentName || departmentName}</span>
                        )}
                    </p>
                </motion.div>
            </div>
        </motion.div>
    );
};

export default OrgContextHeader;

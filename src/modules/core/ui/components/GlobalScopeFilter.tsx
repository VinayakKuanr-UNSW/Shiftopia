import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ScopeTree, ScopeOrg, ScopeDept, ScopeSelection } from '@/platform/auth/types';
import { ChevronDown, Lock, Building2, Layers, Users2 } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';

// =============================================
// Types
// =============================================

export interface LockConfig {
    orgLocked: boolean;
    deptLocked: boolean;
    subDeptLocked: boolean;
}

export interface GlobalScopeFilterProps {
    /** The allowed scope tree from the permission object */
    allowedScopeTree: ScopeTree;
    /** Which fields are locked (derived from certificate level) */
    lockConfig: LockConfig;
    /** Default/initial values (for locked fields, these are the certificate values) */
    defaultSelection?: Partial<ScopeSelection>;
    /** Callback when scope changes */
    onScopeChange: (scope: ScopeSelection) => void;
    /** Optional: hide the filter entirely (e.g. for Gamma managerial) */
    hidden?: boolean;
    /** Optional: mode label */
    mode?: 'personal' | 'managerial';
    /** Enable multi-select (checkboxes + select all). Default true for personal, false for managerial */
    multiSelect?: boolean;
    className?: string;
}

// =============================================
// Multi-Select Dropdown Component
// =============================================

interface MultiSelectProps {
    label: string;
    icon: React.ReactNode;
    options: { id: string; name: string }[];
    selected: string[];
    onChange: (ids: string[]) => void;
    locked: boolean;
    disabled?: boolean;
    /** If false, behaves as single-select (click = select one) */
    multiSelect?: boolean;
}

const MultiSelect: React.FC<MultiSelectProps> = ({
    label,
    icon,
    options,
    selected,
    onChange,
    locked,
    disabled = false,
    multiSelect = true,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const isDisabled = locked || disabled;

    const selectedCount = selected.length;
    const allSelected = options.length > 0 && selectedCount === options.length;

    const displayText = useMemo(() => {
        if (selectedCount === 0) return `Select ${label}`;
        if (allSelected && options.length > 1) return `All ${label}s`;
        if (selectedCount === 1) {
            const item = options.find(o => o.id === selected[0]);
            return item?.name || `1 ${label}`;
        }
        return `${selectedCount} ${label}s`;
    }, [selected, options, label, selectedCount, allSelected]);

    const toggleOption = (id: string) => {
        if (!multiSelect) {
            // Single-select: just pick this one
            onChange([id]);
            setIsOpen(false);
            return;
        }
        if (selected.includes(id)) {
            // Don't allow deselecting the last item
            if (selected.length > 1) {
                onChange(selected.filter(s => s !== id));
            }
        } else {
            onChange([...selected, id]);
        }
    };

    const toggleAll = () => {
        if (allSelected) {
            // Keep only the first selected
            onChange([options[0].id]);
        } else {
            onChange(options.map(o => o.id));
        }
    };

    return (
        <div className="relative">
            <button
                onClick={() => !isDisabled && setIsOpen(!isOpen)}
                className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                    "border min-w-[180px] justify-between",
                    isDisabled
                        ? "bg-slate-100 dark:bg-white/[0.02] border-slate-200 dark:border-white/[0.06] text-slate-400 dark:text-white/40 cursor-not-allowed"
                        : "bg-white dark:bg-white/[0.04] border-slate-200 dark:border-white/[0.08] text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/[0.08] hover:border-slate-300 dark:hover:border-white/[0.12] cursor-pointer"
                )}
                disabled={isDisabled}
                type="button"
            >
                <span className="flex items-center gap-2">
                    {icon}
                    <span className="truncate max-w-[140px]">{displayText}</span>
                </span>
                {locked ? (
                    <Lock className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400/60 flex-shrink-0" />
                ) : (
                    <ChevronDown className={cn(
                        "w-3.5 h-3.5 text-slate-400 dark:text-white/40 flex-shrink-0 transition-transform",
                        isOpen && "rotate-180"
                    )} />
                )}
            </button>

            {isOpen && !isDisabled && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute top-full mt-1 left-0 z-50 min-w-[220px] max-h-[280px] overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1a2744] shadow-xl backdrop-blur-xl">
                        {/* Select All — only in multi-select mode */}
                        {multiSelect && options.length > 1 && (
                            <>
                                <button
                                    onClick={toggleAll}
                                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-600 dark:text-white/70 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
                                    type="button"
                                >
                                    <div className={cn(
                                        "w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold",
                                        allSelected
                                            ? "bg-primary border-primary text-white"
                                            : "border-slate-300 dark:border-white/20"
                                    )}>
                                        {allSelected && '✓'}
                                    </div>
                                    <span className="font-medium">Select All</span>
                                </button>
                                <div className="border-t border-slate-100 dark:border-white/[0.06]" />
                            </>
                        )}
                        {/* Options */}
                        {options.map(opt => (
                            <button
                                key={opt.id}
                                onClick={() => toggleOption(opt.id)}
                                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 dark:text-white/80 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
                                type="button"
                            >
                                <div className={cn(
                                    "w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold",
                                    multiSelect ? "border" : "",
                                    selected.includes(opt.id)
                                        ? multiSelect
                                            ? "bg-primary border-primary text-white"
                                            : "text-primary"
                                        : "border-slate-300 dark:border-white/20"
                                )}>
                                    {selected.includes(opt.id) && (multiSelect ? '✓' : '●')}
                                </div>
                                <span className="truncate">{opt.name}</span>
                            </button>
                        ))}
                        {options.length === 0 && (
                            <div className="px-3 py-2 text-sm text-slate-400 dark:text-white/40 italic">
                                No options available
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

// =============================================
// GlobalScopeFilter (Core)
// =============================================

export const GlobalScopeFilter: React.FC<GlobalScopeFilterProps> = ({
    allowedScopeTree,
    lockConfig,
    defaultSelection,
    onScopeChange,
    hidden = false,
    mode,
    multiSelect = true,
    className,
}) => {
    const orgs = allowedScopeTree?.organizations || [];

    // Initialize selected IDs
    const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>(() => {
        const initial = defaultSelection?.org_ids || [];
        if (initial.length > 0) return initial;
        if (orgs.length === 0) return [];
        return multiSelect ? orgs.map(o => o.id) : [orgs[0].id];
    });
    const [selectedDeptIds, setSelectedDeptIds] = useState<string[]>(() => {
        const initial = defaultSelection?.dept_ids || [];
        if (initial.length > 0) return multiSelect ? initial : [initial[0]];
        return [];
    });
    const [selectedSubDeptIds, setSelectedSubDeptIds] = useState<string[]>(() => {
        const initial = defaultSelection?.subdept_ids || [];
        if (initial.length > 0) return multiSelect ? initial : [initial[0]];
        return [];
    });

    // Derive available departments based on selected orgs
    const availableDepts = useMemo(() => {
        const depts: { id: string; name: string }[] = [];
        orgs
            .filter(o => selectedOrgIds.includes(o.id))
            .forEach(o => {
                o.departments.forEach(d => {
                    depts.push({ id: d.id, name: d.name });
                });
            });
        return depts;
    }, [orgs, selectedOrgIds]);

    // Derive available sub-departments based on selected depts
    const availableSubDepts = useMemo(() => {
        const subDepts: { id: string; name: string }[] = [];
        orgs.forEach(o => {
            o.departments
                .filter(d => selectedDeptIds.includes(d.id))
                .forEach(d => {
                    d.subdepartments.forEach(sd => {
                        subDepts.push({ id: sd.id, name: sd.name });
                    });
                });
        });
        return subDepts;
    }, [orgs, selectedDeptIds]);

    // Auto-select all depts when orgs change (for unlocked depts)
    useEffect(() => {
        if (!lockConfig.deptLocked) {
            const allDeptIds = availableDepts.map(d => d.id);
            setSelectedDeptIds(prev => {
                // Keep only valid selections
                const valid = prev.filter(id => allDeptIds.includes(id));
                if (multiSelect) {
                    return valid.length > 0 ? valid : allDeptIds;
                } else {
                    // Single select fallback: first available
                    return valid.length > 0 ? [valid[0]] : (allDeptIds.length > 0 ? [allDeptIds[0]] : []);
                }
            });
        }
    }, [availableDepts, lockConfig.deptLocked, multiSelect]);

    // Auto-select all sub-depts when depts change (for unlocked sub-depts)
    useEffect(() => {
        if (!lockConfig.subDeptLocked) {
            const allSubDeptIds = availableSubDepts.map(sd => sd.id);
            setSelectedSubDeptIds(prev => {
                const valid = prev.filter(id => allSubDeptIds.includes(id));
                if (multiSelect) {
                    return valid.length > 0 ? valid : allSubDeptIds;
                } else {
                    // Single select fallback: first available
                    return valid.length > 0 ? [valid[0]] : (allSubDeptIds.length > 0 ? [allSubDeptIds[0]] : []);
                }
            });
        }
    }, [availableSubDepts, lockConfig.subDeptLocked, multiSelect]);

    // Emit scope changes
    const emitScope = useCallback(() => {
        const scope: ScopeSelection = {
            org_ids: selectedOrgIds,
            dept_ids: selectedDeptIds,
            subdept_ids: selectedSubDeptIds,
        };

        // Validate: all selected IDs must be in the allowed tree
        const validOrgIds = orgs.map(o => o.id);
        const validScope = scope.org_ids.every(id => validOrgIds.includes(id));

        if (validScope) {
            onScopeChange(scope);
        }
    }, [selectedOrgIds, selectedDeptIds, selectedSubDeptIds, orgs, onScopeChange]);

    useEffect(() => {
        emitScope();
    }, [emitScope]);

    if (hidden) return null;

    return (
        <div className={cn(
            "flex items-center gap-3 p-3 rounded-xl relative z-30",
            "bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/[0.06] backdrop-blur-sm",
            className
        )}>
            {mode && (
                <span className={cn(
                    "px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider",
                    mode === 'personal'
                        ? "bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-500/20"
                        : "bg-purple-100 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-300 dark:border-purple-500/20"
                )}>
                    {mode}
                </span>
            )}

            <MultiSelect
                label="Organization"
                icon={<Building2 className="w-4 h-4 text-blue-500 dark:text-blue-400/70" />}
                options={orgs.map(o => ({ id: o.id, name: o.name }))}
                selected={selectedOrgIds}
                onChange={setSelectedOrgIds}
                locked={lockConfig.orgLocked}
                multiSelect={multiSelect}
            />

            <MultiSelect
                label="Department"
                icon={<Layers className="w-4 h-4 text-emerald-600 dark:text-emerald-400/70" />}
                options={availableDepts}
                selected={selectedDeptIds}
                onChange={setSelectedDeptIds}
                locked={lockConfig.deptLocked}
                disabled={selectedOrgIds.length === 0}
                multiSelect={multiSelect}
            />

            <MultiSelect
                label="Sub-Department"
                icon={<Users2 className="w-4 h-4 text-amber-600 dark:text-amber-400/70" />}
                options={availableSubDepts}
                selected={selectedSubDeptIds}
                onChange={setSelectedSubDeptIds}
                locked={lockConfig.subDeptLocked}
                disabled={selectedDeptIds.length === 0}
                multiSelect={multiSelect}
            />
        </div>
    );
};

export default GlobalScopeFilter;

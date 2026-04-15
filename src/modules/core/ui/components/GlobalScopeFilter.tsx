import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ScopeTree, ScopeOrg, ScopeDept, ScopeSelection } from '@/platform/auth/types';
import { ChevronDown, Lock, Building2, Layers, Users2 } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
// SidebarTrigger removed as it conflicts with AppLayout persistent toggle

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
                    "border min-w-[80px] sm:min-w-[150px] justify-between w-full",
                    isDisabled
                        ? "bg-slate-100 dark:bg-white/[0.02] border-slate-200 dark:border-white/[0.06] text-slate-400 dark:text-white/40 cursor-not-allowed"
                        : "bg-white dark:bg-white/[0.04] border-slate-200 dark:border-white/[0.08] text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/[0.08] hover:border-slate-300 dark:hover:border-white/[0.12] cursor-pointer"
                )}
                disabled={isDisabled}
                type="button"
            >
                <span className="flex items-center gap-1.5 sm:gap-2">
                    {icon}
                    <span className="truncate max-w-[80px] sm:max-w-[140px] text-xs sm:text-sm">{displayText}</span>
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

    // Emit scope changes — debounced so rapid auto-select cascades
    // (org → dept → subdept) collapse into a single parent update.
    const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onScopeChangeRef = useRef(onScopeChange);
    useEffect(() => { onScopeChangeRef.current = onScopeChange; }, [onScopeChange]);

    useEffect(() => {
        const validOrgIds     = orgs.map(o => o.id);
        const validDeptIds    = orgs.flatMap(o => o.departments.map(d => d.id));
        const validSubDeptIds = orgs.flatMap(o =>
            o.departments.flatMap(d => d.subdepartments.map(sd => sd.id))
        );

        const scope: ScopeSelection = {
            org_ids: selectedOrgIds,
            dept_ids: selectedDeptIds,
            subdept_ids: selectedSubDeptIds,
        };

        const isValid =
            scope.org_ids.every(id => validOrgIds.includes(id)) &&
            scope.dept_ids.every(id => validDeptIds.includes(id)) &&
            scope.subdept_ids.every(id => validSubDeptIds.includes(id));

        if (!isValid) return;

        if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
        emitTimerRef.current = setTimeout(() => {
            onScopeChangeRef.current(scope);
        }, 0);

        return () => {
            if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
        };
    }, [selectedOrgIds, selectedDeptIds, selectedSubDeptIds, orgs]);

    if (hidden) return null;

    return (
        <div className={cn(
            "flex flex-col gap-1 p-1.5 rounded-xl relative z-30",
            "bg-slate-50 dark:bg-[#1a2744]/20 border border-slate-200 dark:border-white/[0.03] backdrop-blur-xl shadow-lg",
            className
        )}>
            <div className="flex items-center gap-1.5 w-full">
                {/* Unified Sidebar Trigger removed as it conflicts with AppLayout persistent toggle */}
                
                <div className="flex-1 min-w-0">
                    <MultiSelect
                        label="Venue"
                        options={orgs.map(o => ({ id: o.id, name: o.name }))}
                        selected={selectedOrgIds}
                        onChange={setSelectedOrgIds}
                        locked={lockConfig.orgLocked}
                        multiSelect={multiSelect}
                        compact={true}
                    />
                </div>

                <div className="flex-1 min-w-0">
                    <MultiSelect
                        label="Department"
                        options={availableDepts}
                        selected={selectedDeptIds}
                        onChange={setSelectedDeptIds}
                        locked={lockConfig.deptLocked}
                        disabled={selectedOrgIds.length === 0}
                        multiSelect={multiSelect}
                        compact={true}
                    />
                </div>

                <div className="flex-1 min-w-0">
                    <MultiSelect
                        label="Sub-Department"
                        options={availableSubDepts}
                        selected={selectedSubDeptIds}
                        onChange={setSelectedSubDeptIds}
                        locked={lockConfig.subDeptLocked}
                        disabled={selectedDeptIds.length === 0}
                        multiSelect={multiSelect}
                        compact={true}
                    />
                </div>
            </div>
        </div>
    );
};

export default GlobalScopeFilter;

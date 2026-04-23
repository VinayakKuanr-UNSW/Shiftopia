import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ScopeTree, ScopeOrg, ScopeDept, ScopeSelection } from '@/platform/auth/types';
import { ChevronDown, Lock, Building2, Layers, Users2, Filter, MoreHorizontal, Check, Settings2 } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useBreakpoint } from '@/modules/core/hooks/useBreakpoint';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    SheetDescription,
} from '@/modules/core/ui/primitives/sheet';
import { Button } from '@/modules/core/ui/primitives/button';

// =============================================
// Types
// =============================================
// ... (LockConfig and GlobalScopeFilterProps interfaces remain same, eliding for brevity if possible, but tool rules say exact match or replace block)
// I'll replace the whole file for safety if needed, or just the main component and imports.

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
    /** Mobile optimization flag */
    isMobile?: boolean;
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
    isMobile = false,
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

    if (isMobile) {
        return (
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between px-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2">
                        {icon}
                        {label}
                    </label>
                    {locked && <Lock className="w-3 h-3 text-amber-500/50" />}
                </div>
                
                <div className="flex flex-wrap gap-2.5 min-h-[52px] p-3 rounded-2xl bg-muted/40 border border-border/40 shadow-inner">
                    {options.map(opt => {
                        const isSelected = selected.includes(opt.id);
                        return (
                            <button
                                key={opt.id}
                                onClick={() => !isDisabled && toggleOption(opt.id)}
                                disabled={isDisabled}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[12px] font-black uppercase tracking-tight transition-all active:scale-90",
                                    isSelected 
                                        ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" 
                                        : "bg-background/80 border border-border/80 text-muted-foreground hover:border-primary/40",
                                    isDisabled && "opacity-40 grayscale cursor-not-allowed"
                                )}
                            >
                                {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={3} />}
                                {opt.name}
                            </button>
                        );
                    })}
                    {options.length === 0 && (
                        <span className="text-[11px] font-semibold text-muted-foreground/40 italic px-2 py-2">No options available</span>
                    )}
                </div>
                
                {multiSelect && options.length > 1 && !isDisabled && (
                    <button 
                        onClick={toggleAll}
                        className="text-[11px] font-black uppercase tracking-widest text-primary/60 hover:text-primary active:scale-90 w-fit px-1 mt-1 transition-all"
                    >
                        {allSelected ? "Clear Selection" : "Select All"}
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="relative">
            <button
                onClick={() => !isDisabled && setIsOpen(!isOpen)}
                className={cn(
                    "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                    "border-0 min-w-[120px] sm:min-w-[180px] justify-between w-full h-14",
                    isDisabled
                        ? "bg-slate-100 dark:bg-white/[0.02] text-slate-400 dark:text-white/40 cursor-not-allowed opacity-50"
                        : "bg-white dark:bg-[#1c2333] text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-[#252d40] cursor-pointer shadow-sm"
                )}
                disabled={isDisabled}
                type="button"
            >
                <div className="flex flex-col items-start gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-white/30 leading-none">{label}</span>
                    <span className="truncate max-w-[120px] sm:max-w-[180px] text-xs sm:text-sm font-semibold">{displayText}</span>
                </div>
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
    const breakpoint = useBreakpoint();
    const isMobile = breakpoint === 'mobile';

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

    // Summary text for mobile button (must be at top level)
    const summaryText = useMemo(() => {
        if (selectedOrgIds.length === 0) return "Scope Hidden";
        if (selectedOrgIds.length === orgs.length && orgs.length > 1) return "All Venues";
        if (selectedOrgIds.length === 1) {
            const org = orgs.find(o => o.id === selectedOrgIds[0]);
            return org?.name || "Single Venue";
        }
        return `${selectedOrgIds.length} Venues`;
    }, [selectedOrgIds, orgs]);

    if (hidden) return null;

    if (isMobile) {
        return (
            <div className={cn("w-full mb-2 px-0.5", className)}>
                <Sheet>
                    <SheetTrigger asChild>
                        <button className="flex items-center justify-between w-full px-4 py-3 bg-card/60 backdrop-blur-md border border-border/40 rounded-2xl shadow-sm active:scale-[0.98] transition-all group">
                            <div className="flex items-center gap-3">
                                <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary transition-colors group-hover:bg-primary/20">
                                    <Building2 className="w-5 h-5" />
                                </div>
                                <div className="flex flex-col items-start">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 leading-none mb-1">Organizational Scope</span>
                                    <span className="text-sm font-bold text-foreground truncate max-w-[180px]">{summaryText}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center -space-x-1.5 mr-1">
                                    {selectedDeptIds.length > 0 && <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-background" />}
                                    {selectedSubDeptIds.length > 0 && <div className="h-1.5 w-1.5 rounded-full bg-blue-500 ring-2 ring-background" />}
                                </div>
                                <div className="h-8 w-8 rounded-full bg-muted/40 flex items-center justify-center text-muted-foreground">
                                    <Settings2 className="w-4 h-4" />
                                </div>
                            </div>
                        </button>
                    </SheetTrigger>
                    <SheetContent side="bottom" className="rounded-t-[2.5rem] border-t-0 p-0 bg-background/95 backdrop-blur-2xl max-h-[90vh] flex flex-col">
                        <div className="mx-auto w-12 h-1.5 bg-muted/60 rounded-full my-4 flex-shrink-0" />
                        
                        <div className="flex-1 overflow-y-auto px-6 pb-24">
                            <SheetHeader className="mb-8 text-left">
                                <SheetTitle className="text-2xl font-black flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                                        <Filter className="w-5 h-5" />
                                    </div>
                                    Filter Scope
                                </SheetTitle>
                                <SheetDescription className="text-sm font-medium text-muted-foreground/80 mt-1">
                                    Select the organizations and departments to refine your view.
                                </SheetDescription>
                            </SheetHeader>

                            <div className="space-y-10">
                                <MultiSelect
                                    label="Venue / Office"
                                    icon={<Building2 className="w-3.5 h-3.5" />}
                                    options={orgs.map(o => ({ id: o.id, name: o.name }))}
                                    selected={selectedOrgIds}
                                    onChange={setSelectedOrgIds}
                                    locked={lockConfig.orgLocked}
                                    multiSelect={multiSelect}
                                    isMobile={true}
                                />

                                <MultiSelect
                                    label="Department"
                                    icon={<Layers className="w-3.5 h-3.5" />}
                                    options={availableDepts}
                                    selected={selectedDeptIds}
                                    onChange={setSelectedDeptIds}
                                    locked={lockConfig.deptLocked}
                                    disabled={selectedOrgIds.length === 0}
                                    multiSelect={multiSelect}
                                    isMobile={true}
                                />

                                <MultiSelect
                                    label="Sub-Department / Group"
                                    icon={<Users2 className="w-3.5 h-3.5" />}
                                    options={availableSubDepts}
                                    selected={selectedSubDeptIds}
                                    onChange={setSelectedSubDeptIds}
                                    locked={lockConfig.subDeptLocked}
                                    disabled={selectedDeptIds.length === 0}
                                    multiSelect={multiSelect}
                                    isMobile={true}
                                />
                            </div>
                        </div>
                    </SheetContent>
                </Sheet>
            </div>
        );
    }

    return (
        <div className={cn(
            "flex flex-col gap-1 rounded-xl relative z-30 w-full",
            className
        )}>
            <div className="flex items-center gap-1.5 w-full">
                <div className="flex-1 min-w-0">
                    <MultiSelect
                        label="Location"
                        icon={<Building2 className="w-4 h-4 text-slate-400 dark:text-white/30" />}
                        options={orgs.map(o => ({ id: o.id, name: o.name }))}
                        selected={selectedOrgIds}
                        onChange={setSelectedOrgIds}
                        locked={lockConfig.orgLocked}
                        multiSelect={multiSelect}
                    />
                </div>

                <div className="flex-1 min-w-0">
                    <MultiSelect
                        label="Department"
                        icon={<Layers className="w-3.5 h-3.5 text-slate-400 dark:text-white/30" />}
                        options={availableDepts}
                        selected={selectedDeptIds}
                        onChange={setSelectedDeptIds}
                        locked={lockConfig.deptLocked}
                        disabled={selectedOrgIds.length === 0}
                        multiSelect={multiSelect}
                    />
                </div>

                <div className="flex-1 min-w-0">
                    <MultiSelect
                        label="Sub-Department"
                        icon={<Users2 className="w-3.5 h-3.5 text-slate-400 dark:text-white/30" />}
                        options={availableSubDepts}
                        selected={selectedSubDeptIds}
                        onChange={setSelectedSubDeptIds}
                        locked={lockConfig.subDeptLocked}
                        disabled={selectedDeptIds.length === 0}
                        multiSelect={multiSelect}
                    />
                </div>
            </div>
        </div>
    );
};

export default GlobalScopeFilter;

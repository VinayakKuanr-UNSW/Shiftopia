import React from 'react';
import { format, parseISO } from 'date-fns';
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/modules/core/ui/primitives/form';
import { Input } from '@/modules/core/ui/primitives/input';
import { Label } from '@/modules/core/ui/primitives/label';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { cn } from '@/modules/core/lib/utils';
import { formatHours } from '../utils';
import type { ScheduleStepProps } from '../types';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import {
    Clock,
    Timer,
    X,
    CheckCircle,
    AlertCircle,
    AlertTriangle,
    ArrowRight,
    Lock,
} from 'lucide-react';
import { useScopeFilter } from '@/platform/auth/useScopeFilter';
import { HierarchyColumn } from './HierarchyColumn';

export const ScheduleStep: React.FC<ScheduleStepProps> = ({
    form,
    isReadOnly,
    shiftLength,
    netLength,
    hardValidation,
    rosters,
    rosterStructure,
    selectedRosterId,
    onRosterChange,
    isGroupLocked,
    isSubGroupLocked,
    isRosterLocked,
    context,
}) => {
    const watchPaidBreak = form.watch('paid_break_minutes');
    const watchUnpaidBreak = form.watch('unpaid_break_minutes');
    const watchGroupType = form.watch('group_type');

    // State for toggling between dropdown and text input for Sub-Group
    const [isCustomSubGroup, setIsCustomSubGroup] = React.useState(false);

    // Reset custom mode when group changes, unless locked
    React.useEffect(() => {
        if (!isGroupLocked) {
            // setIsCustomSubGroup(false); 
            // Better UX: Don't auto-reset if user is intentionally creating a new one, 
            // but do reset if they change the parent group to keep options valid.
            // However, if we switch groups, the previous subgroup val might be invalid anyway.
            // Let's keep it simple: if group changes, we re-evaluate availableSubGroups.
            // If availableSubGroups becomes available, we might want to show them.
            // But if user was in custom mode, maybe they want to stay? 
            // Defaulting to false (show list) is safer standard behavior.
            setIsCustomSubGroup(false);
        }
    }, [watchGroupType, isGroupLocked]);

    // Derive available groups and subgroups
    const availableGroups = React.useMemo(() => {
        if (!rosterStructure?.length) return [];
        return Array.from(new Set(rosterStructure.map(x => x.groupType))).filter(Boolean);
    }, [rosterStructure]);

    const availableSubGroups = React.useMemo(() => {
        if (!rosterStructure?.length || !watchGroupType) return [];
        return Array.from(new Set(
            rosterStructure
                .filter(x => x.groupType === watchGroupType)
                .map(x => x.subGroupName)
        )).filter(Boolean);
    }, [rosterStructure, watchGroupType]);

    // Fallback options if structure is empty (e.g. new roster)
    const showDefaultGroups = !rosterStructure?.length;

    // Handle applying scope from card
    const handleApplyScope = (scope: { orgId?: string; deptId?: string; subDeptId?: string }) => {
        if (!rosters.length) return;

        // Find a roster that matches the scope context
        // Prioritize exact match on sub-dept, then dept
        let match = rosters.find(r =>
            (scope.deptId && r.department_id === scope.deptId) &&
            (!scope.subDeptId || r.sub_department_id === scope.subDeptId)
        );

        // If no strict sub-dept match, fall back to dept match
        if (!match && scope.deptId) {
            match = rosters.find(r => r.department_id === scope.deptId);
        }

        if (match) {
            onRosterChange(match.id);
        }
    };

    // Current context derived from selected roster
    const selectedRoster = rosters.find(r => r.id === selectedRosterId);

    // Sync Roster with Global Scope
    const { scope } = useScopeFilter('managerial');

    React.useEffect(() => {
        if (!rosters.length) return;

        // Only enforce if we have a department scope
        const scopeDeptId = scope?.dept_ids?.[0];
        const scopeSubDeptId = scope?.subdept_ids?.[0];

        if (!scopeDeptId) return;

        // Check if current selection matches scope
        if (selectedRoster) {
            const matchesDept = selectedRoster.department_id === scopeDeptId;
            const matchesSubDept = !scopeSubDeptId || selectedRoster.sub_department_id === scopeSubDeptId;

            if (matchesDept && matchesSubDept) return; // Already valid
        }

        // Find best match
        let match = rosters.find(r =>
            r.department_id === scopeDeptId &&
            (!scopeSubDeptId || r.sub_department_id === scopeSubDeptId)
        );

        if (!match) {
            // Fallback to purely dept match
            match = rosters.find(r => r.department_id === scopeDeptId);
        }

        if (match) {
            console.log('[ScheduleStep] Auto-selecting roster from scope:', match.name);
            onRosterChange(match.id);
        }
    }, [scope, rosters, selectedRoster, onRosterChange]); // Dependencies ensure we react to scope scope/roster changes

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-4 gap-4 auto-rows-fr">
                {/* COLUMN 1: HIERARCHY (Locked Global Scope) */}
                <HierarchyColumn
                    orgId={context?.organizationId}
                    deptId={context?.departmentId}
                    subDeptId={context?.subDepartmentId}
                />
                {/* COLUMN 1: CONTEXT */}
                <div className="flex flex-col h-full rounded-2xl bg-[#1e293b]/30 border border-white/5 backdrop-blur-md overflow-hidden shadow-2xl transition-all duration-300 hover:border-amber-500/20 group/card">
                    <div className="p-4 border-b border-white/5 bg-white/[0.02] flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)] group-hover/card:shadow-[0_0_20px_rgba(245,158,11,0.3)] transition-all">
                            <Lock className="h-5 w-5" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-white tracking-tight uppercase">Context</h3>
                            <p className="text-[10px] text-white/30 font-medium">Shift Assignment Details</p>
                        </div>
                    </div>

                    <div className="p-5 flex flex-col gap-6 flex-1">
                        {/* Slot 1: Roster */}
                        <div className="min-h-[70px] flex flex-col justify-center">
                            {!isReadOnly ? (
                                <div className="space-y-2">
                                    <Label className="text-[11px] font-bold text-white/40 uppercase tracking-[0.1em]">Roster</Label>
                                    {rosters?.length > 0 ? (
                                        <Select
                                            disabled={isReadOnly || isRosterLocked}
                                            value={selectedRosterId}
                                            onValueChange={onRosterChange}
                                        >
                                            <SelectTrigger className="h-11 bg-white/[0.03] border-white/5 text-white text-sm hover:bg-white/10 hover:border-white/10 transition-all rounded-xl focus:ring-2 focus:ring-amber-500/30">
                                                <SelectValue placeholder="Select roster" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-[#1e293b] border-white/10 backdrop-blur-xl">
                                                {rosters.map((roster) => (
                                                    <SelectItem key={roster.id} value={roster.id} className="text-sm focus:bg-amber-500/10 focus:text-amber-400">
                                                        {roster.name || roster.description || (roster.start_date ? format(parseISO(roster.start_date), 'dd MMM yyyy') : 'Unknown Roster')}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <div className="flex items-center gap-2 p-3 text-amber-400 rounded-xl border border-amber-500/10 bg-amber-500/5 text-xs">
                                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                            <span>No rosters found.</span>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    <Label className="text-[11px] font-bold text-white/40 uppercase tracking-[0.1em]">Roster</Label>
                                    <div className="text-sm text-white/60 font-medium px-1">Selected View Only</div>
                                </div>
                            )}
                        </div>

                        {/* Slot 2: Group */}
                        <div className="min-h-[70px] flex flex-col justify-center">
                            <FormField
                                control={form.control}
                                name="group_type"
                                render={({ field }) => (
                                    <FormItem className="space-y-2">
                                        <FormLabel className="text-[11px] font-bold text-white/40 uppercase tracking-[0.1em]">Group</FormLabel>
                                        <Select
                                            disabled={isReadOnly || isGroupLocked}
                                            onValueChange={(val) => {
                                                field.onChange(val);
                                                form.setValue('sub_group_name', '');
                                            }}
                                            defaultValue={field.value}
                                            value={field.value}
                                        >
                                            <FormControl>
                                                <SelectTrigger className={cn(
                                                    "h-11 bg-white/[0.03] border-white/5 text-white text-sm hover:bg-white/10 hover:border-white/10 transition-all rounded-xl",
                                                    isGroupLocked && "opacity-50 cursor-not-allowed bg-white/[0.01]"
                                                )}>
                                                    <SelectValue placeholder="Select group" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="bg-[#1e293b] border-white/10 backdrop-blur-xl">
                                                {showDefaultGroups ? (
                                                    <>
                                                        <SelectItem value="convention_centre">Convention Centre</SelectItem>
                                                        <SelectItem value="exhibition_centre">Exhibition Centre</SelectItem>
                                                        <SelectItem value="theatre">Theatre</SelectItem>
                                                    </>
                                                ) : (
                                                    availableGroups.map(g => (
                                                        <SelectItem key={g} value={g} className="focus:bg-amber-500/10 focus:text-amber-400">
                                                            {g?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                                        </SelectItem>
                                                    ))
                                                )}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage className="text-[10px] text-amber-400/80" />
                                    </FormItem>
                                )}
                            />
                        </div>

                        {/* Slot 3: Subgroup */}
                        <div className="min-h-[70px] flex flex-col justify-center">
                            <FormField
                                control={form.control}
                                name="sub_group_name"
                                render={({ field }) => (
                                    <FormItem className="space-y-2">
                                        <FormLabel className="text-[11px] font-bold text-white/40 uppercase tracking-[0.1em]">Sub-Group</FormLabel>
                                        {isSubGroupLocked ? (
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    disabled={true}
                                                    className="h-11 bg-white/[0.02] border-white/5 text-white/60 text-sm rounded-xl cursor-not-allowed"
                                                />
                                            </FormControl>
                                        ) : (!isCustomSubGroup && availableSubGroups.length > 0) ? (
                                            <Select
                                                disabled={isReadOnly || !watchGroupType}
                                                onValueChange={(val) => {
                                                    if (val === '__NEW__') {
                                                        setIsCustomSubGroup(true);
                                                        field.onChange('');
                                                    } else {
                                                        field.onChange(val);
                                                    }
                                                }}
                                                value={field.value}
                                            >
                                                <FormControl>
                                                    <SelectTrigger className="h-11 bg-white/[0.03] border-white/5 text-white text-sm hover:bg-white/10 hover:border-white/10 transition-all rounded-xl">
                                                        <SelectValue placeholder="Select sub-group" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent className="bg-[#1e293b] border-white/10 backdrop-blur-xl">
                                                    {availableSubGroups.map(sg => (
                                                        <SelectItem key={sg} value={sg} className="focus:bg-amber-500/10 focus:text-amber-400">
                                                            {sg?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                                        </SelectItem>
                                                    ))}
                                                    <div className="h-px bg-white/5 my-1" />
                                                    <SelectItem value="__NEW__" className="text-emerald-400 font-bold">
                                                        + Create New
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <div className="flex gap-2">
                                                <FormControl>
                                                    <Input
                                                        placeholder="Name..."
                                                        className="h-11 bg-white/[0.03] border-white/5 text-white text-sm placeholder:text-white/20 rounded-xl focus:border-amber-500/50 transition-all"
                                                        disabled={isReadOnly}
                                                        {...field}
                                                    />
                                                </FormControl>
                                                {!isReadOnly && availableSubGroups.length > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setIsCustomSubGroup(false);
                                                            field.onChange('');
                                                        }}
                                                        className="px-4 h-11 text-xs font-bold text-white/40 hover:text-white bg-white/5 rounded-xl border border-white/5 hover:border-white/20 transition-all uppercase tracking-tighter"
                                                    >
                                                        List
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                        <FormMessage className="text-[10px] text-amber-400/80" />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </div>
                </div>

                {/* COLUMN 2: TIMINGS */}
                <div className="flex flex-col h-full rounded-2xl bg-[#1e293b]/30 border border-white/5 backdrop-blur-md overflow-hidden shadow-2xl transition-all duration-300 hover:border-emerald-500/20 group/card">
                    <div className="p-4 border-b border-white/5 bg-white/[0.02] flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.2)] group-hover/card:shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all">
                            <Clock className="h-5 w-5" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-white tracking-tight uppercase">Timings</h3>
                            <p className="text-[10px] text-white/30 font-medium">Shift Start & End</p>
                        </div>
                    </div>

                    <div className="p-5 flex flex-col gap-6 flex-1">
                        {/* Slot 1: Start Time */}
                        <div className="min-h-[70px] flex flex-col justify-center">
                            <FormField
                                control={form.control}
                                name="start_time"
                                render={({ field }) => (
                                    <FormItem className="space-y-2">
                                        <FormLabel className="text-[11px] font-bold text-white/40 uppercase tracking-[0.1em]">Start Time</FormLabel>
                                        <FormControl>
                                            <div className="relative group/input">
                                                <Input
                                                    type="time"
                                                    step="900"
                                                    className="h-11 text-lg font-black bg-white/[0.03] border-white/5 text-white focus:bg-white/[0.05] focus:border-emerald-500/50 transition-all rounded-xl pl-4"
                                                    disabled={isReadOnly}
                                                    {...field}
                                                />
                                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white/10 group-focus-within/input:text-emerald-500/40 transition-colors uppercase">
                                                    15m
                                                </div>
                                            </div>
                                        </FormControl>
                                        <FormMessage className="text-[10px] text-emerald-500/80" />
                                    </FormItem>
                                )}
                            />
                        </div>

                        {/* Slot 2: End Time */}
                        <div className="min-h-[70px] flex flex-col justify-center">
                            <FormField
                                control={form.control}
                                name="end_time"
                                render={({ field }) => (
                                    <FormItem className="space-y-2">
                                        <FormLabel className="text-[11px] font-bold text-white/40 uppercase tracking-[0.1em]">End Time</FormLabel>
                                        <FormControl>
                                            <div className="relative group/input">
                                                <Input
                                                    type="time"
                                                    step="900"
                                                    className="h-11 text-lg font-black bg-white/[0.03] border-white/5 text-white focus:bg-white/[0.05] focus:border-emerald-500/50 transition-all rounded-xl pl-4"
                                                    disabled={isReadOnly}
                                                    {...field}
                                                />
                                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white/10 group-focus-within/input:text-emerald-500/40 transition-colors uppercase">
                                                    15m
                                                </div>
                                            </div>
                                        </FormControl>
                                        <FormMessage className="text-[10px] text-emerald-500/80" />
                                    </FormItem>
                                )}
                            />
                        </div>

                        {/* Slot 3: Gross Length Card */}
                        <div className="min-h-[70px] flex flex-col justify-center">
                            <Label className="text-[11px] font-bold text-white/40 uppercase tracking-[0.1em] mb-2">Length</Label>
                            <div className={cn(
                                "relative p-4 rounded-2xl border transition-all duration-300",
                                shiftLength > 0 ? "bg-emerald-500/[0.08] border-emerald-500/30 shadow-[0_0_30px_-10px_rgba(16,185,129,0.2)]" : "bg-white/[0.02] border-white/5"
                            )}>
                                {shiftLength > 0 && (
                                    <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/0 via-emerald-500/[0.05] to-emerald-500/0" />
                                )}

                                <div className="flex items-baseline gap-2 relative z-10">
                                    <p className="text-3xl font-bold text-white tracking-tight">
                                        {shiftLength.toFixed(1)}
                                    </p>
                                    <p className="text-sm font-medium text-emerald-400 group-hover:text-emerald-300 transition-colors uppercase tracking-widest">
                                        Hours
                                    </p>
                                </div>
                                <p className="text-[10px] text-zinc-500 mt-1 font-medium uppercase tracking-wider relative z-10">Total length</p>

                                {shiftLength > 12 && (
                                    <div className="mt-3 p-2 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2 relative z-10">
                                        <AlertTriangle className="h-3 w-3 text-red-400" />
                                        <p className="text-[10px] font-bold text-red-400 uppercase tracking-tight">Long Shift Alert</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* COLUMN 3: BREAKS */}
                <div className="flex flex-col h-full rounded-2xl bg-[#1e293b]/30 border border-white/5 backdrop-blur-md overflow-hidden shadow-2xl transition-all duration-300 hover:border-blue-500/20 group/card">
                    <div className="p-4 border-b border-white/5 bg-white/[0.02] flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.2)] group-hover/card:shadow-[0_0_20px_rgba(59,130,246,0.3)] transition-all">
                            <Timer className="h-5 w-5" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-white tracking-tight uppercase">Breaks</h3>
                            <p className="text-[10px] text-white/30 font-medium">Pay Deductions</p>
                        </div>
                    </div>

                    <div className="p-5 flex flex-col gap-6 flex-1">
                        {/* Slot 1: Paid Break */}
                        <div className="min-h-[70px] flex flex-col justify-center">
                            <FormField
                                control={form.control}
                                name="paid_break_minutes"
                                render={({ field }) => (
                                    <FormItem className="space-y-2">
                                        <FormLabel className="text-[11px] font-bold text-white/40 uppercase tracking-[0.1em] flex justify-between">
                                            Paid Break <span className="text-[9px] font-black lowercase opacity-40">(min)</span>
                                        </FormLabel>
                                        <FormControl>
                                            <div className="relative group/input">
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    className="h-11 pl-4 bg-white/[0.03] border-white/5 text-white focus:bg-white/[0.05] focus:border-blue-500/50 transition-all rounded-xl"
                                                    disabled={isReadOnly}
                                                    value={field.value ?? ''}
                                                    onChange={(e) => {
                                                        const val = e.target.valueAsNumber;
                                                        field.onChange(isNaN(val) ? undefined : val);
                                                    }}
                                                />
                                                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                                    <CheckCircle className={cn(
                                                        "h-4 w-4 transition-all",
                                                        (field.value ?? 0) > 0 ? "text-emerald-500 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "text-white/5"
                                                    )} />
                                                </div>
                                            </div>
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>

                        {/* Slot 2: Unpaid Break */}
                        <div className="min-h-[70px] flex flex-col justify-center">
                            <FormField
                                control={form.control}
                                name="unpaid_break_minutes"
                                render={({ field }) => (
                                    <FormItem className="space-y-2">
                                        <FormLabel className="text-[11px] font-bold text-white/40 uppercase tracking-[0.1em] flex justify-between">
                                            Unpaid Break <span className="text-[9px] font-black lowercase opacity-40">(min)</span>
                                        </FormLabel>
                                        <FormControl>
                                            <div className="relative group/input">
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    className="h-11 pl-4 bg-white/[0.03] border-white/5 text-white focus:bg-white/[0.05] focus:border-rose-500/50 transition-all rounded-xl"
                                                    disabled={isReadOnly}
                                                    value={field.value ?? ''}
                                                    onChange={(e) => {
                                                        const val = e.target.valueAsNumber;
                                                        field.onChange(isNaN(val) ? undefined : val);
                                                    }}
                                                />
                                                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                                    <X className={cn(
                                                        "h-4 w-4 transition-all",
                                                        (field.value ?? 0) > 0 ? "text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]" : "text-white/5"
                                                    )} />
                                                </div>
                                            </div>
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>

                        {/* Slot 3: Net Length Card */}
                        <div className="min-h-[70px] flex flex-col justify-center">
                            <Label className="text-[11px] font-bold text-white/40 uppercase tracking-[0.1em] mb-2 font-serif">Net Length</Label>
                            <div className={cn(
                                "h-14 px-5 rounded-2xl border flex flex-col justify-center transition-all duration-500 relative overflow-hidden group/net",
                                netLength > 0 ? "bg-blue-500/[0.08] border-blue-500/30 shadow-[0_0_30px_-10px_rgba(59,130,246,0.2)]" : "bg-white/[0.02] border-white/5"
                            )}>
                                {netLength > 0 && (
                                    <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 via-blue-500/[0.05] to-blue-500/0" />
                                )}

                                <div className="flex items-baseline gap-2 relative z-10">
                                    <span className={cn(
                                        "text-2xl font-black tracking-tighter transition-all",
                                        netLength > 0 ? "text-white" : "text-white/10"
                                    )}>
                                        {formatHours(netLength)}
                                    </span>
                                    <span className={cn(
                                        "text-[10px] font-black uppercase tracking-widest transition-colors",
                                        netLength > 0 ? "text-blue-400/80" : "text-white/5"
                                    )}>
                                        Paid Hours
                                    </span>
                                </div>
                                {netLength > 0 && (
                                    <p className="text-[9px] text-emerald-400/50 font-medium tracking-tight relative z-10">Auto-calculated per policy</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ERROR ALERTS */}
            {!hardValidation.passed && (
                <div className="fade-in slide-in-from-top-2 duration-500">
                    <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/20 backdrop-blur-sm flex items-start gap-4 shadow-lg shadow-red-500/5">
                        <div className="p-2 rounded-xl bg-red-500/10">
                            <AlertTriangle className="h-5 w-5 text-red-500" />
                        </div>
                        <div className="space-y-1.5 flex-1 pt-1">
                            <h4 className="text-xs font-black text-red-500 uppercase tracking-widest">Compliance Warnings</h4>
                            <div className="space-y-1">
                                {hardValidation.errors.map((error, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                        <div className="h-1 w-1 rounded-full bg-red-500/40" />
                                        <p className="text-xs font-semibold text-red-400 leading-relaxed italic">
                                            {error.message}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

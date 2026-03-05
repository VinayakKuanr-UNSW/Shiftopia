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
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { cn } from '@/modules/core/lib/utils';
import { formatHours, formatTimeDisplay } from '../utils';
import type { ScheduleStepProps } from '../types';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/modules/core/ui/primitives/select';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import {
    Clock,
    Timer,
    X,
    CheckCircle,
    AlertCircle,
    AlertTriangle,
    Briefcase,
    Tag,
    Lock,
    StickyNote,
    Star,
    Shield,
    CalendarCheck,
} from 'lucide-react';
import {
    HierarchyColumn
} from './HierarchyColumn';
import { MultiSelect } from './MultiSelect';

/* ═══════════════════════════════════════════════════════════════════════
   MINI BADGE — used in Column 5 for high-density requirement display
   ═══════════════════════════════════════════════════════════════════════ */
const MiniBadge = ({ label, color = 'emerald' }: { label: string; color?: string }) => {
    const colorMap: Record<string, string> = {
        emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
        amber: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
        blue: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
        violet: 'bg-violet-500/15 text-violet-400 border-violet-500/20',
        rose: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
    };
    return (
        <TooltipProvider delayDuration={200}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className={cn(
                        'inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold border truncate max-w-[100px] cursor-default',
                        colorMap[color] || colorMap.emerald
                    )}>
                        {label}
                    </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-popover border-border text-popover-foreground text-xs">
                    {label}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

/* ═══════════════════════════════════════════════════════════════════════
   SCHEDULE STEP — 6-column dense layout
   Col 1: Hierarchy   Col 2: Context   Col 3: Timings
   Col 4: Breaks      Col 5: Criteria  Col 6: Notes
   ═══════════════════════════════════════════════════════════════════════ */

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
    isTemplateMode: isTemplateModeProp,
    context,
    activeSubGroups = {},
    // Column 5 props
    roles,
    remunerationLevels,
    skills,
    licenses,
    events,
    selectedRemLevel,
    isRoleLocked,
}) => {
    const watchPaidBreak = form.watch('paid_break_minutes');
    const watchUnpaidBreak = form.watch('unpaid_break_minutes');
    const watchGroupType = form.watch('group_type');
    const watchSubGroup = form.watch('sub_group_name');
    const watchRoleId = form.watch('role_id');
    const watchSkills = form.watch('required_skills') || [];
    const watchLicenses = form.watch('required_licenses') || [];
    const watchEvents = form.watch('event_ids') || [];

    // Reset custom mode when group changes, unless locked
    React.useEffect(() => {
        if (!isGroupLocked) {
            // noop — guard for future custom group logic
        }
    }, [watchGroupType, isGroupLocked]);

    // Derived Logic
    const availableGroups = React.useMemo(() => {
        if (!rosterStructure?.length) return [];
        return Array.from(new Set(rosterStructure.map(x => x.groupType))).filter(Boolean);
    }, [rosterStructure]);

    const availableSubGroups = React.useMemo(() => {
        const structureSubGroups = !rosterStructure?.length || !watchGroupType
            ? []
            : Array.from(new Set(
                rosterStructure
                    .filter(x => x.groupType === watchGroupType)
                    .map(x => x.subGroupName)
            )).filter(Boolean);

        const activeForGroup = (activeSubGroups && watchGroupType)
            ? activeSubGroups[watchGroupType] || []
            : [];

        return Array.from(new Set([...structureSubGroups, ...activeForGroup]));
    }, [rosterStructure, watchGroupType, activeSubGroups]);

    const showDefaultGroups = !availableGroups.length;

    const isTemplateMode = isTemplateModeProp || context?.mode === 'template';
    const selectedRoster = rosters.find(r => r.id === selectedRosterId);
    const isRosterActive = isTemplateMode || (selectedRoster?.status === 'published' || selectedRoster?.status === 'draft');

    // Sync Roster with Global Scope
    React.useEffect(() => {
        if (isTemplateMode) return;
        if (!rosters.length || !context?.date) return;

        const match = rosters.find(r => r.start_date === context.date);
        if (match) {
            console.log('[ScheduleStep] Auto-selecting roster matching date:', match.name);
            onRosterChange(match.id);
        }
    }, [isTemplateMode, rosters, onRosterChange, context?.date]);

    // Resolve names for badge display
    const selectedRole = roles.find(r => r.id === watchRoleId);
    const selectedSkillNames = skills.filter(s => watchSkills.includes(s.id)).map(s => s.name);
    const selectedLicenseNames = licenses.filter(l => watchLicenses.includes(l.id)).map(l => l.name);
    const selectedEventNames = events.filter(e => watchEvents.includes(e.id)).map(e => e.name);

    return (
        <div className="space-y-5">
            {/* ───────── ROW 1: 6-COLUMN DENSE GRID ───────── */}
            <div className="grid grid-cols-6 gap-3 auto-rows-fr">

                {/* ── COL 1: HIERARCHY ─────────────────── */}
                <HierarchyColumn
                    orgId={context?.organizationId}
                    deptId={context?.departmentId}
                    subDeptId={context?.subDepartmentId}
                    orgName={context?.organizationName}
                    deptName={context?.departmentName}
                    subDeptName={context?.subDepartmentName}
                />

                {/* ── COL 2: CONTEXT ──────────────────── */}
                <div className="flex flex-col h-full rounded-2xl bg-card border border-border backdrop-blur-md overflow-hidden shadow-2xl transition-all duration-300 hover:border-amber-500/20 group/card">
                    <div className="p-3 border-b border-border bg-muted/50 flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.15)]">
                            <Lock className="h-4 w-4" />
                        </div>
                        <div>
                            <h3 className="text-[11px] font-bold text-foreground tracking-tight uppercase">Context</h3>
                            <p className="text-[9px] text-muted-foreground font-medium">Assignment Details</p>
                        </div>
                    </div>

                    <div className="p-3 flex flex-col gap-4 flex-1">
                        {/* Roster */}
                        <div className="flex flex-col justify-center">
                            {isTemplateMode ? (
                                <div className="space-y-1">
                                    <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">Roster</Label>
                                    <div className="flex items-center gap-1.5 p-2 text-muted-foreground/50 rounded-lg border border-border bg-muted/30 text-[10px]">
                                        <Lock className="w-3 h-3 opacity-50" />
                                        <span>N/A — templates</span>
                                    </div>
                                </div>
                            ) : !isReadOnly ? (
                                <div className="space-y-1">
                                    <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">Roster</Label>
                                    {rosters?.length > 0 ? (
                                        <Select
                                            disabled={isReadOnly || isRosterLocked}
                                            value={selectedRosterId}
                                            onValueChange={onRosterChange}
                                        >
                                            <SelectTrigger className={cn(
                                                "h-8 bg-muted/50 border-border text-foreground text-[11px] hover:bg-accent transition-all rounded-lg focus:ring-1 focus:ring-amber-500/30",
                                                !selectedRosterId && "border-amber-500/50"
                                            )}>
                                                <SelectValue placeholder="Select roster" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-popover border-border backdrop-blur-xl">
                                                {rosters.map((roster) => (
                                                    <SelectItem key={roster.id} value={roster.id} className="text-[11px] focus:bg-amber-500/10 focus:text-amber-400">
                                                        {roster.name || roster.description || (roster.start_date ? format(parseISO(roster.start_date), 'dd MMM yyyy') : 'Unknown Roster')}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <div className="flex items-center gap-1.5 p-2 text-amber-400 rounded-lg border border-amber-500/10 bg-amber-500/5 text-[10px]">
                                            <AlertCircle className="w-3 h-3 flex-shrink-0" />
                                            <span>No rosters — activate first</span>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">Roster</Label>
                                    <div className="text-[11px] text-muted-foreground font-medium px-1">
                                        {selectedRoster ? (selectedRoster.name || (selectedRoster.start_date ? format(parseISO(selectedRoster.start_date), 'dd MMM yyyy') : 'Unknown')) : 'None'}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Group */}
                        <div className="flex flex-col justify-center">
                            {!isReadOnly ? (
                                <FormField
                                    control={form.control}
                                    name="group_type"
                                    render={({ field }) => (
                                        <FormItem className="space-y-1">
                                            <FormLabel className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">Group</FormLabel>
                                            {isGroupLocked ? (
                                                <FormControl>
                                                    <Input
                                                        {...field}
                                                        value={field.value ? field.value.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : context?.groupName || ''}
                                                        disabled={true}
                                                        className="h-8 bg-muted/40 border-border text-muted-foreground text-[11px] rounded-lg cursor-not-allowed"
                                                    />
                                                </FormControl>
                                            ) : !isRosterActive ? (
                                                <div className="flex items-center gap-1.5 p-2 text-amber-400 rounded-lg border border-amber-500/10 bg-amber-500/5 text-[10px] animate-pulse">
                                                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                                                    <span>Activate roster</span>
                                                </div>
                                            ) : availableGroups.length === 0 ? (
                                                <div className="flex items-center gap-1.5 p-2 text-amber-400 rounded-lg border border-amber-500/10 bg-amber-500/5 text-[10px]">
                                                    <AlertCircle className="w-3 h-3 flex-shrink-0" />
                                                    <span>No groups</span>
                                                </div>
                                            ) : (
                                                <Select
                                                    disabled={isReadOnly || !isRosterActive}
                                                    onValueChange={(val) => {
                                                        field.onChange(val);
                                                        form.setValue('sub_group_name', '');
                                                    }}
                                                    defaultValue={field.value}
                                                    value={field.value}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className={cn(
                                                            "h-8 bg-muted/50 border-border text-foreground text-[11px] hover:bg-accent transition-all rounded-lg",
                                                            !isRosterActive && "opacity-50 cursor-not-allowed"
                                                        )}>
                                                            <SelectValue placeholder="Select group" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="bg-popover border-border backdrop-blur-xl">
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
                                            )}
                                            <FormMessage className="text-[9px] text-amber-400/80" />
                                        </FormItem>
                                    )}
                                />
                            ) : (
                                <div className="space-y-1">
                                    <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">Group</Label>
                                    <div className="text-[11px] text-muted-foreground font-medium px-1">
                                        {watchGroupType ? watchGroupType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Not specified'}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Sub-Group */}
                        <div className="flex flex-col justify-center">
                            {!isReadOnly ? (
                                <FormField
                                    control={form.control}
                                    name="sub_group_name"
                                    render={({ field }) => (
                                        <FormItem className="space-y-1">
                                            <FormLabel className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">Sub-Group</FormLabel>
                                            {isSubGroupLocked ? (
                                                <FormControl>
                                                    <Input
                                                        {...field}
                                                        disabled={true}
                                                        className="h-8 bg-muted/40 border-border text-muted-foreground text-[11px] rounded-lg cursor-not-allowed"
                                                    />
                                                </FormControl>
                                            ) : !isRosterActive || !watchGroupType ? (
                                                <div className="flex items-center gap-1.5 p-2 text-muted-foreground/30 rounded-lg border border-border bg-muted/20 text-[10px] italic">
                                                    <Lock className="w-3 h-3 opacity-50" />
                                                    <span>Select group first</span>
                                                </div>
                                            ) : availableSubGroups.length === 0 ? (
                                                <div className="flex items-center gap-1.5 p-2 text-amber-400/70 rounded-lg border border-amber-500/10 bg-amber-500/5 text-[10px]">
                                                    <AlertCircle className="w-3 h-3 flex-shrink-0" />
                                                    <span>No subgroups</span>
                                                </div>
                                            ) : (
                                                <Select
                                                    disabled={isReadOnly || !watchGroupType || !isRosterActive}
                                                    onValueChange={(val) => { field.onChange(val); }}
                                                    value={field.value}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-8 bg-muted/50 border-border text-foreground text-[11px] hover:bg-accent transition-all rounded-lg">
                                                            <SelectValue placeholder="Select sub-group" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="bg-popover border-border backdrop-blur-xl">
                                                        {availableSubGroups.map((sg) => (
                                                            <SelectItem key={sg} value={sg} className="focus:bg-amber-500/10 focus:text-amber-400">
                                                                {sg}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                            <FormMessage className="text-[9px] text-amber-400/80" />
                                        </FormItem>
                                    )}
                                />
                            ) : (
                                <div className="space-y-1">
                                    <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">Sub-Group</Label>
                                    <div className="text-[11px] text-muted-foreground font-medium px-1">
                                        {watchSubGroup || 'Not specified'}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── COL 3: TIMINGS ──────────────────── */}
                <div className="flex flex-col h-full rounded-2xl bg-card border border-border backdrop-blur-md overflow-hidden shadow-2xl transition-all duration-300 hover:border-emerald-500/20 group/card">
                    <div className="p-3 border-b border-border bg-muted/50 flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.15)]">
                            <Clock className="h-4 w-4" />
                        </div>
                        <div>
                            <h3 className="text-[11px] font-bold text-foreground tracking-tight uppercase">Timings</h3>
                            <p className="text-[9px] text-muted-foreground font-medium">Start & End</p>
                        </div>
                    </div>

                    <div className="p-3 flex flex-col gap-4 flex-1">
                        {/* Start Time */}
                        <FormField
                            control={form.control}
                            name="start_time"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">Start Time</FormLabel>
                                    <FormControl>
                                        {!isReadOnly ? (
                                            <Input
                                                type="time"
                                                step="900"
                                                className="h-8 text-sm font-bold bg-muted/50 border-border text-foreground focus:bg-accent focus:border-emerald-500/50 transition-all rounded-lg"
                                                disabled={isReadOnly}
                                                {...field}
                                            />
                                        ) : (
                                            <div className="text-base font-bold text-foreground px-1">
                                                {formatTimeDisplay(field.value)}
                                            </div>
                                        )}
                                    </FormControl>
                                    <FormMessage className="text-[9px] text-emerald-500/80" />
                                </FormItem>
                            )}
                        />

                        {/* End Time */}
                        <FormField
                            control={form.control}
                            name="end_time"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em]">End Time</FormLabel>
                                    <FormControl>
                                        {!isReadOnly ? (
                                            <Input
                                                type="time"
                                                step="900"
                                                className="h-8 text-sm font-bold bg-muted/50 border-border text-foreground focus:bg-accent focus:border-emerald-500/50 transition-all rounded-lg"
                                                disabled={isReadOnly}
                                                {...field}
                                            />
                                        ) : (
                                            <div className="text-base font-bold text-foreground px-1">
                                                {formatTimeDisplay(field.value)}
                                            </div>
                                        )}
                                    </FormControl>
                                    <FormMessage className="text-[9px] text-emerald-500/80" />
                                </FormItem>
                            )}
                        />

                        {/* Length */}
                        <div>
                            <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em] mb-1 block">Length</Label>
                            <div className={cn(
                                "relative p-2.5 rounded-xl border transition-all duration-300",
                                shiftLength > 0 ? "bg-emerald-500/[0.08] border-emerald-500/30" : "bg-muted/40 border-border"
                            )}>
                                <div className="flex items-baseline gap-1.5">
                                    <p className="text-xl font-bold text-foreground tracking-tight">
                                        {shiftLength.toFixed(1)}
                                    </p>
                                    <p className="text-[10px] font-medium text-emerald-400 uppercase tracking-widest">
                                        Hours
                                    </p>
                                </div>
                                {shiftLength > 12 && (
                                    <div className="mt-1.5 p-1.5 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-1.5">
                                        <AlertTriangle className="h-3 w-3 text-red-400" />
                                        <p className="text-[9px] font-bold text-red-400 uppercase">Long Shift</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── COL 4: BREAKS ───────────────────── */}
                <div className="flex flex-col h-full rounded-2xl bg-card border border-border backdrop-blur-md overflow-hidden shadow-2xl transition-all duration-300 hover:border-blue-500/20 group/card">
                    <div className="p-3 border-b border-border bg-muted/50 flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.15)]">
                            <Timer className="h-4 w-4" />
                        </div>
                        <div>
                            <h3 className="text-[11px] font-bold text-foreground tracking-tight uppercase">Breaks</h3>
                            <p className="text-[9px] text-muted-foreground font-medium">Pay Deductions</p>
                        </div>
                    </div>

                    <div className="p-3 flex flex-col gap-4 flex-1">
                        {/* Paid Break */}
                        <FormField
                            control={form.control}
                            name="paid_break_minutes"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em] flex justify-between">
                                        Paid <span className="text-[8px] lowercase opacity-40">(min)</span>
                                    </FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <Input
                                                type="number"
                                                min="0"
                                                className="h-8 pl-3 bg-muted/50 border-border text-foreground focus:bg-accent focus:border-blue-500/50 transition-all rounded-lg text-[11px]"
                                                disabled={isReadOnly}
                                                value={field.value ?? ''}
                                                onChange={(e) => {
                                                    const val = e.target.valueAsNumber;
                                                    field.onChange(isNaN(val) ? undefined : val);
                                                }}
                                            />
                                            <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                                                <CheckCircle className={cn(
                                                    "h-3 w-3 transition-all",
                                                    (field.value ?? 0) > 0 ? "text-emerald-500" : "text-muted-foreground/10"
                                                )} />
                                            </div>
                                        </div>
                                    </FormControl>
                                </FormItem>
                            )}
                        />

                        {/* Unpaid Break */}
                        <FormField
                            control={form.control}
                            name="unpaid_break_minutes"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em] flex justify-between">
                                        Unpaid <span className="text-[8px] lowercase opacity-40">(min)</span>
                                    </FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <Input
                                                type="number"
                                                min="0"
                                                className="h-8 pl-3 bg-muted/50 border-border text-foreground focus:bg-accent focus:border-rose-500/50 transition-all rounded-lg text-[11px]"
                                                disabled={isReadOnly}
                                                value={field.value ?? ''}
                                                onChange={(e) => {
                                                    const val = e.target.valueAsNumber;
                                                    field.onChange(isNaN(val) ? undefined : val);
                                                }}
                                            />
                                            <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                                                <X className={cn(
                                                    "h-3 w-3 transition-all",
                                                    (field.value ?? 0) > 0 ? "text-rose-500" : "text-muted-foreground/10"
                                                )} />
                                            </div>
                                        </div>
                                    </FormControl>
                                </FormItem>
                            )}
                        />

                        {/* Net Length */}
                        <div>
                            <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em] mb-1 block">Net Length</Label>
                            <div className={cn(
                                "h-12 px-3 rounded-xl border flex flex-col justify-center transition-all duration-500 relative overflow-hidden",
                                netLength > 0 ? "bg-blue-500/[0.08] border-blue-500/30" : "bg-muted/40 border-border"
                            )}>
                                <div className="flex items-baseline gap-1.5">
                                    <span className={cn(
                                        "text-lg font-black tracking-tighter transition-all",
                                        netLength > 0 ? "text-foreground" : "text-muted-foreground/10"
                                    )}>
                                        {formatHours(netLength)}
                                    </span>
                                    <span className={cn(
                                        "text-[9px] font-black uppercase tracking-widest transition-colors",
                                        netLength > 0 ? "text-blue-400/80" : "text-muted-foreground/10"
                                    )}>
                                        Paid
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── COL 5: ASSIGNMENT CRITERIA ─────── */}
                <div className="flex flex-col h-full rounded-2xl bg-card border border-border backdrop-blur-md overflow-hidden shadow-2xl transition-all duration-300 hover:border-cyan-500/20 group/card">
                    <div className="p-3 border-b border-border bg-muted/50 flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.15)]">
                            <Tag className="h-4 w-4" />
                        </div>
                        <div>
                            <h3 className="text-[11px] font-bold text-foreground tracking-tight uppercase">Criteria</h3>
                            <p className="text-[9px] text-muted-foreground font-medium">Role & Requirements</p>
                        </div>
                    </div>

                    <div className="p-3 flex flex-col gap-3 flex-1 overflow-y-auto">
                        {/* Role */}
                        <FormField
                            control={form.control}
                            name="role_id"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em] flex items-center gap-1">
                                        <Briefcase className="h-3 w-3" /> Role *
                                    </FormLabel>
                                    {!isReadOnly && !isRoleLocked ? (
                                        <Select onValueChange={field.onChange} value={field.value || ''} disabled={isReadOnly || isRoleLocked}>
                                            <FormControl>
                                                <SelectTrigger className={cn(
                                                    "h-8 bg-muted/50 border-border text-foreground text-[11px] hover:bg-accent transition-all rounded-lg",
                                                    !field.value && "border-amber-500/50"
                                                )}>
                                                    <SelectValue placeholder="Select role" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="bg-popover border-border">
                                                {roles.map((role) => (
                                                    <SelectItem key={role.id} value={role.id} className="text-[11px] text-foreground">
                                                        {role.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <div className="text-[11px] font-medium text-foreground px-1">
                                            {selectedRole?.name || 'No role'}
                                        </div>
                                    )}
                                    <FormMessage className="text-[9px]" />
                                </FormItem>
                            )}
                        />

                        {/* Pay Level — derived from role */}
                        {selectedRemLevel && (
                            <div className="space-y-1">
                                <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em] flex items-center gap-1">
                                    <Star className="h-3 w-3" /> Pay
                                </Label>
                                <MiniBadge label={`${selectedRemLevel.level_name} — $${selectedRemLevel.hourly_rate_min}/hr`} color="amber" />
                            </div>
                        )}

                        {/* Skills */}
                        <FormField
                            control={form.control}
                            name="required_skills"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em] flex items-center gap-1">
                                        <Shield className="h-3 w-3" /> Skills
                                    </FormLabel>
                                    {!isReadOnly ? (
                                        <FormControl>
                                            <MultiSelect
                                                options={skills.map(s => ({ id: s.id, name: s.name }))}
                                                selected={field.value || []}
                                                onChange={field.onChange}
                                                placeholder="Skills..."
                                                disabled={isReadOnly}
                                            />
                                        </FormControl>
                                    ) : (
                                        <div className="flex flex-wrap gap-1">
                                            {selectedSkillNames.length > 0
                                                ? selectedSkillNames.map(name => <MiniBadge key={name} label={name} color="emerald" />)
                                                : <span className="text-[10px] text-muted-foreground/30">None</span>}
                                        </div>
                                    )}
                                </FormItem>
                            )}
                        />

                        {/* Licenses */}
                        <FormField
                            control={form.control}
                            name="required_licenses"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em] flex items-center gap-1">
                                        <CalendarCheck className="h-3 w-3" /> Licenses
                                    </FormLabel>
                                    {!isReadOnly ? (
                                        <FormControl>
                                            <MultiSelect
                                                options={licenses.map(l => ({ id: l.id, name: l.name }))}
                                                selected={field.value || []}
                                                onChange={field.onChange}
                                                placeholder="Licenses..."
                                                disabled={isReadOnly}
                                            />
                                        </FormControl>
                                    ) : (
                                        <div className="flex flex-wrap gap-1">
                                            {selectedLicenseNames.length > 0
                                                ? selectedLicenseNames.map(name => <MiniBadge key={name} label={name} color="blue" />)
                                                : <span className="text-[10px] text-muted-foreground/30">None</span>}
                                        </div>
                                    )}
                                </FormItem>
                            )}
                        />

                        {/* Events */}
                        <FormField
                            control={form.control}
                            name="event_ids"
                            render={({ field }) => (
                                <FormItem className="space-y-1">
                                    <FormLabel className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.08em] flex items-center gap-1">
                                        <CalendarCheck className="h-3 w-3" /> Events
                                    </FormLabel>
                                    {!isReadOnly ? (
                                        <FormControl>
                                            <MultiSelect
                                                options={events.map(e => ({ id: e.id, name: e.name }))}
                                                selected={field.value || []}
                                                onChange={field.onChange}
                                                placeholder="Events..."
                                                disabled={isReadOnly}
                                            />
                                        </FormControl>
                                    ) : (
                                        <div className="flex flex-wrap gap-1">
                                            {selectedEventNames.length > 0
                                                ? selectedEventNames.map(name => <MiniBadge key={name} label={name} color="violet" />)
                                                : <span className="text-[10px] text-muted-foreground/30">None</span>}
                                        </div>
                                    )}
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                {/* ── COL 6: NOTES ────────────────────── */}
                <div className="flex flex-col h-full rounded-2xl bg-card border border-border backdrop-blur-md overflow-hidden shadow-2xl transition-all duration-300 hover:border-rose-500/20 group/card">
                    <div className="p-3 border-b border-border bg-muted/50 flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.15)]">
                            <StickyNote className="h-4 w-4" />
                        </div>
                        <div>
                            <h3 className="text-[11px] font-bold text-foreground tracking-tight uppercase">Notes</h3>
                            <p className="text-[9px] text-muted-foreground font-medium">Shift Remarks</p>
                        </div>
                    </div>

                    <div className="p-3 flex-1">
                        <FormField
                            control={form.control}
                            name="notes"
                            render={({ field }) => (
                                <FormItem className="h-full">
                                    <FormControl>
                                        <Textarea
                                            placeholder="Add notes for this shift..."
                                            className="h-full min-h-[200px] bg-muted/50 border-border text-foreground resize-none text-[11px] rounded-lg focus:border-rose-500/30"
                                            disabled={isReadOnly}
                                            {...field}
                                        />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                    </div>
                </div>
            </div>

            {/* ── ERROR ALERTS ────────────────────── */}
            {!hardValidation.passed && (
                <div className="fade-in slide-in-from-top-2 duration-500">
                    <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/20 backdrop-blur-sm flex items-start gap-3 shadow-lg shadow-red-500/5">
                        <div className="p-1.5 rounded-lg bg-red-500/10">
                            <AlertTriangle className="h-4 w-4 text-red-500" />
                        </div>
                        <div className="space-y-1 flex-1 pt-0.5">
                            <h4 className="text-[10px] font-black text-red-500 uppercase tracking-widest">Compliance Warnings</h4>
                            <div className="space-y-1">
                                {hardValidation.errors.map((error, idx) => (
                                    <div key={idx} className="flex items-center gap-1.5">
                                        <div className="h-1 w-1 rounded-full bg-red-500/40" />
                                        <p className="text-[10px] font-semibold text-red-400 leading-relaxed italic">
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

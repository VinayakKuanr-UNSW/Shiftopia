import React from 'react';
import { Database, Hash, Building2, MapPin, Briefcase, Tag, Settings, Timer, History, CalendarIcon as CalendarIcon2 } from 'lucide-react';
import { Separator } from '@/modules/core/ui/primitives/separator';
import { Button } from '@/modules/core/ui/primitives/button';
import { useToast } from '@/modules/core/hooks/use-toast';
import { cn } from '@/modules/core/lib/utils';
import { format } from 'date-fns';
import { ShiftAuditTrail } from '@/modules/rosters/ui/components/ShiftAuditTrail';
import { ReviewLogsStepProps } from '../types';

/* ============================================================
   SYSTEM FIELD HELPER
   ============================================================ */
const SystemField = ({
    label,
    value,
    icon,
    highlight,
    copyable
}: {
    label: string,
    value: any,
    icon?: React.ReactNode,
    highlight?: boolean,
    copyable?: boolean
}) => {
    const { toast } = useToast();
    return (
        <div className={cn("p-2 rounded bg-black/20 border border-white/5", highlight && "bg-emerald-500/10 border-emerald-500/20")}>
            <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-white/40 font-medium flex items-center gap-1.5">
                    {icon}
                    {label}
                </span>
                {copyable && value && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 text-white/20 hover:text-white"
                        onClick={(e) => {
                            e.preventDefault();
                            navigator.clipboard.writeText(String(value));
                            toast({ title: "Copied to clipboard" });
                        }}
                    >
                        <Hash className="h-2.5 w-2.5" />
                    </Button>
                )}
            </div>
            <div className={cn("text-xs font-mono truncate", highlight ? "text-emerald-400 font-medium" : "text-white/70")}>
                {value || '—'}
            </div>
        </div>
    );
};

export const ReviewLogsStep: React.FC<ReviewLogsStepProps> = ({
    form,
    editMode,
    existingShift,
    safeContext,
    selectedRosterId,
    shiftLength,
    netLength,
}) => {
    const watchStart = form.watch('start_time');
    const watchEnd = form.watch('end_time');
    const watchPaidBreak = form.watch('paid_break_minutes');
    const watchUnpaidBreak = form.watch('unpaid_break_minutes');

    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <h4 className="text-sm font-medium text-white/70 flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Identifiers
                </h4>
                <div className="grid grid-cols-2 gap-3">
                    <SystemField label="Shift ID" value={editMode ? existingShift?.id : '(Auto-generated)'} icon={<Hash className="h-3 w-3" />} copyable={!!existingShift?.id} />
                    <SystemField label="Roster ID" value={selectedRosterId || safeContext.rosterId} icon={<Hash className="h-3 w-3" />} copyable />
                    <SystemField label="Organization ID" value={safeContext.organizationId} icon={<Building2 className="h-3 w-3" />} copyable />
                    <SystemField label="Department ID" value={safeContext.departmentId} icon={<MapPin className="h-3 w-3" />} highlight={!!safeContext.departmentId} copyable />
                    <SystemField label="Sub-Department ID" value={safeContext.subDepartmentId} icon={<MapPin className="h-3 w-3" />} copyable />
                    <SystemField label="Role ID" value={form.watch('role_id')} icon={<Briefcase className="h-3 w-3" />} copyable />
                </div>
            </div>

            <Separator className="bg-white/10" />

            <div className="space-y-3">
                <h4 className="text-sm font-medium text-white/70 flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    Visual Grouping
                </h4>
                <div className="grid grid-cols-2 gap-3">
                    <SystemField label="Group Name" value={safeContext.groupName} highlight />
                    <SystemField label="Group ID" value={safeContext.groupId} copyable />
                    <SystemField label="Sub-Group Name" value={safeContext.subGroupName} highlight />
                    <SystemField label="Sub-Group ID" value={safeContext.subGroupId} copyable />
                    <SystemField label="Group Color" value={safeContext.groupColor} />
                    <SystemField label="View Mode" value={safeContext.mode} />
                </div>
            </div>

            <Separator className="bg-white/10" />

            <div className="space-y-3">
                <h4 className="text-sm font-medium text-white/70 flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Status & Flags
                </h4>
                <div className="grid grid-cols-3 gap-3">
                    <SystemField label="Status" value={existingShift?.status || 'open'} />
                    <SystemField label="Is Draft" value={existingShift?.is_draft?.toString() ?? 'true'} highlight />
                    <SystemField label="Is Published" value={existingShift?.is_published?.toString() ?? 'false'} />
                    <SystemField label="Is On Bidding" value={existingShift?.is_on_bidding?.toString() ?? 'false'} />
                    <SystemField label="Version" value={existingShift?.version || '1'} />
                    <SystemField label="Display Order" value={existingShift?.display_order || '0'} />
                </div>
            </div>

            <Separator className="bg-white/10" />

            <div className="space-y-3">
                <h4 className="text-sm font-medium text-white/70 flex items-center gap-2">
                    <Timer className="h-4 w-4" />
                    Calculated Values
                </h4>
                <div className="grid grid-cols-3 gap-3">
                    <SystemField label="Gross Minutes" value={Math.round(shiftLength * 60) || '—'} highlight={shiftLength > 0} />
                    <SystemField label="Net Minutes" value={Math.round(netLength * 60) || '—'} highlight={netLength > 0} />
                    <SystemField label="Is Overnight" value={watchEnd && watchStart && watchEnd < watchStart ? 'Yes' : 'No'} />
                    <SystemField label="Paid Break" value={watchPaidBreak ? `${watchPaidBreak} min` : '—'} />
                    <SystemField label="Unpaid Break" value={watchUnpaidBreak ? `${watchUnpaidBreak} min` : '—'} />
                    <SystemField label="Timezone" value={form.watch('timezone')} />
                </div>
            </div>

            <Separator className="bg-white/10" />

            <div className="space-y-3">
                <h4 className="text-sm font-medium text-white/70 flex items-center gap-2">
                    <CalendarIcon2 className="h-4 w-4" />
                    Date & Time
                </h4>
                <div className="grid grid-cols-3 gap-3">
                    <SystemField label="Shift Date" value={safeContext.date || (form.watch('shift_date') ? format(form.watch('shift_date'), 'yyyy-MM-dd') : '—')} highlight />
                    <SystemField label="Start Time" value={form.watch('start_time') || '—'} />
                    <SystemField label="End Time" value={form.watch('end_time') || '—'} />
                </div>
            </div>

            {/* Audit Trail included in Review Logs step for edit mode */}
            {editMode && existingShift?.id && (
                <div className="mt-8 pt-8 border-t border-white/10">
                    <h3 className="text-sm font-medium text-white/70 mb-4 flex items-center gap-2">
                        <History className="h-4 w-4" />
                        Audit History
                    </h3>
                    <ShiftAuditTrail shiftId={existingShift.id} className="h-[350px]" />
                </div>
            )}
        </div>
    );
};

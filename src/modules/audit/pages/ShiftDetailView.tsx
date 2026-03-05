import { useState, useEffect, startTransition } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft,
    Calendar,
    Clock,
    MapPin,
    User,
    Download,
    ChevronRight,
    CheckCircle,
    XCircle,
    AlertTriangle
} from 'lucide-react';
import { TimelineEvent } from '../components/TimelineEvent';
import { useShiftAudit } from '../hooks/useAuditData';
import { supabase } from '@/platform/realtime/client';
import { format } from 'date-fns';
import { cn } from '@/modules/core/lib/utils';

interface ShiftData {
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    assigned_employee_id: string | null;
    created_by_user_id: string | null;
    created_at: string;
    updated_at: string;
    lifecycle_status: string;
    role_name: string | null;
    assigned_employee_name: string | null;
    creator_name: string | null;
    sub_department_name: string | null;
    department_name: string | null;
    organization_name: string | null;
}

function ShiftDetailView() {
    const { shiftId } = useParams<{ shiftId: string }>();
    const navigate = useNavigate();
    const { timeline, loading } = useShiftAudit(shiftId || '');
    const [showJsonModal, setShowJsonModal] = useState(false);
    const [shiftData, setShiftData] = useState<ShiftData | null>(null);
    const [loadingShift, setLoadingShift] = useState(true);

    useEffect(() => {
        if (shiftId) {
            fetchShiftData();
        }
    }, [shiftId]);

    const fetchShiftData = async () => {
        setLoadingShift(true);
        try {
            // Fetch basic shift data
            const { data: shift, error } = await supabase
                .from('shifts')
                .select('*')
                .eq('id', shiftId)
                .single();

            if (error) {
                console.error('Shift fetch error:', error);
                throw error;
            }

            console.log('Fetched shift data:', shift);

            // Fetch role name
            let roleName = null;
            if (shift.role_id) {
                const { data: role } = await supabase
                    .from('roles')
                    .select('name')
                    .eq('id', shift.role_id)
                    .single();
                roleName = role?.name;
            }

            // Fetch assigned employee name
            let employeeName = null;
            if (shift.assigned_employee_id) {
                const { data: employee } = await supabase
                    .from('profiles')
                    .select('full_name')
                    .eq('id', shift.assigned_employee_id)
                    .single();
                employeeName = employee?.full_name;
            }

            // Fetch location hierarchy
            let orgName = null, deptName = null, subDeptName = null;
            if (shift.sub_department_id) {
                const { data: subDept } = await supabase
                    .from('sub_departments')
                    .select('name, department_id')
                    .eq('id', shift.sub_department_id)
                    .single();

                subDeptName = subDept?.name;

                if (subDept?.department_id) {
                    const { data: dept } = await supabase
                        .from('departments')
                        .select('name, organization_id')
                        .eq('id', subDept.department_id)
                        .single();

                    deptName = dept?.name;

                    if (dept?.organization_id) {
                        const { data: org } = await supabase
                            .from('organizations')
                            .select('name')
                            .eq('id', dept.organization_id)
                            .single();

                        orgName = org?.name;
                    }
                }
            }

            // Fetch creator name
            let creatorName = 'Unknown User';
            if (shift.created_by_user_id) {
                const { data: creator } = await supabase
                    .from('profiles')
                    .select('full_name')
                    .eq('id', shift.created_by_user_id)
                    .single();
                creatorName = creator?.full_name || 'Unknown User';
            }

            setShiftData({
                id: shift.id,
                shift_date: shift.shift_date,
                start_time: shift.start_time,
                end_time: shift.end_time,
                assigned_employee_id: shift.assigned_employee_id,
                created_by_user_id: shift.created_by_user_id,
                created_at: shift.created_at,
                updated_at: shift.updated_at,
                lifecycle_status: shift.lifecycle_status,
                role_name: roleName,
                assigned_employee_name: employeeName,
                creator_name: creatorName,
                sub_department_name: subDeptName,
                department_name: deptName,
                organization_name: orgName,
            });
        } catch (err) {
            console.error('Error fetching shift data:', err);
        } finally {
            setLoadingShift(false);
        }
    };

    /**
     * Handle reverting an audit event
     * Restores the shift to the state before the event occurred
     */
    const handleRevert = async (snapshotId: string) => {
        if (!confirm('Are you sure you want to revert this change? This will restore the shift to its previous state.')) {
            return;
        }

        try {
            // TODO: Implement revert logic
            // 1. Find the snapshot in timeline
            // 2. Get old_data from shift_audit_events
            // 3. Update shift with old_data values
            // 4. Create new audit event documenting the revert
            console.log('Reverting snapshot:', snapshotId);
            alert('Revert functionality: Coming soon!');
        } catch (err) {
            console.error('Revert error:', err);
            alert('Failed to revert change');
        }
    };

    if (loading || loadingShift) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center text-foreground font-medium">
                Loading shift audit trail...
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background text-foreground">
            {/* Header */}
            <div className="bg-card/50 backdrop-blur-md border-b border-border/50 p-5 sticky top-0 z-50">
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-5">
                        <button
                            onClick={() => startTransition(() => navigate('/audit'))}
                            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-all font-bold text-sm tracking-tight hover:-translate-x-1"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to Dashboard
                        </button>
                        <div className="h-6 w-px bg-border" />
                        <h1 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
                            <span className="text-muted-foreground/50">Shift</span>
                            <span className="text-primary">#{shiftId?.slice(0, 8).toUpperCase()}</span>
                        </h1>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => {
                                // Navigate to the shifts roster page with this shift
                                startTransition(() => {
                                    navigate(`/rosters?shiftId=${shiftId}`);
                                });
                            }}
                            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 text-[11px] font-black uppercase tracking-widest flex items-center gap-2"
                        >
                            Jump to Current
                        </button>
                        <button
                            onClick={() => {
                                // Scroll to the last (most recent) event
                                const events = document.querySelectorAll('[id^="event-"]');
                                if (events.length > 0) {
                                    events[events.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
                                }
                            }}
                            className="px-4 py-2 rounded-xl bg-muted/40 hover:bg-muted text-foreground border border-border/50 transition-all text-[11px] font-black uppercase tracking-widest flex items-center gap-2"
                        >
                            Go to Latest Event
                        </button>
                        <button
                            onClick={() => setShowJsonModal(true)}
                            className="px-4 py-2 rounded-xl border border-border/80 hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-all text-[11px] font-black uppercase tracking-widest"
                        >
                            View JSON Source
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="w-full p-8 max-w-[1600px] mx-auto">
                <div className="grid grid-cols-12 gap-8">
                    {/* Left Sidebar - Current Snapshot */}
                    <div className="col-span-3">
                        <div className="bg-card border border-border/50 rounded-2xl p-6 sticky top-28 shadow-xl shadow-primary/5">
                            <h2 className="text-[11px] font-black text-muted-foreground/50 uppercase tracking-[0.2em] mb-6">Current Status</h2>

                            <div className="space-y-6">
                                <div>
                                    <span className={cn(
                                        "inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest border border-border/50 shadow-sm",
                                        shiftData?.lifecycle_status === 'draft'
                                            ? 'bg-muted/50 text-muted-foreground'
                                            : shiftData?.lifecycle_status === 'published'
                                                ? 'bg-primary/10 text-primary border-primary/20'
                                                : shiftData?.assigned_employee_id
                                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                                                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                                    )}>
                                        ● {shiftData?.assigned_employee_id ? 'Assigned' : shiftData?.lifecycle_status || 'Draft'}
                                    </span>
                                </div>

                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 mb-1.5">Role</div>
                                    <div className="text-sm text-foreground font-bold">{shiftData?.role_name || 'N/A'}</div>
                                </div>

                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 mb-1.5">Date & Time</div>
                                    <div className="text-sm text-foreground font-medium">
                                        {shiftData?.shift_date ? format(new Date(shiftData.shift_date), 'MMM dd, yyyy') : 'N/A'}
                                    </div>
                                    <div className="text-sm text-muted-foreground font-mono mt-0.5">
                                        {shiftData?.start_time && shiftData?.end_time
                                            ? `${shiftData.start_time.slice(0, 5)} - ${shiftData.end_time.slice(0, 5)}`
                                            : 'N/A'
                                        }
                                    </div>
                                </div>

                                {shiftData?.organization_name && (
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 mb-1.5">Location</div>
                                        <div className="text-sm text-foreground font-medium flex items-center gap-1.5 flex-wrap">
                                            <span>{shiftData.organization_name}</span>
                                            {shiftData.department_name && <><span className="text-muted-foreground/30">›</span><span>{shiftData.department_name}</span></>}
                                            {shiftData.sub_department_name && <><span className="text-muted-foreground/30">›</span><span>{shiftData.sub_department_name}</span></>}
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 mb-2">Current Owner</div>
                                    {shiftData?.assigned_employee_name ? (
                                        <div className="flex items-center gap-3 bg-muted/30 p-2.5 rounded-xl border border-border/50">
                                            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-[10px] font-black text-primary-foreground shadow-md shadow-primary/20">
                                                {shiftData.assigned_employee_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                            </div>
                                            <div className="text-sm text-foreground font-bold">{shiftData.assigned_employee_name}</div>
                                        </div>
                                    ) : (
                                        <div className="text-sm text-muted-foreground/60 italic font-medium bg-muted/30 p-2.5 rounded-xl border border-border/50 text-center">Unassigned</div>
                                    )}
                                </div>

                                <div className="border-t border-border/50 pt-5">
                                    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 mb-3">System Metadata</div>

                                    <div className="text-xs space-y-3">
                                        <div className="bg-muted/30 p-3 rounded-xl border border-border/50">
                                            <div className="text-muted-foreground/70 font-medium mb-1">Created by</div>
                                            <div className="text-foreground font-bold">{shiftData?.creator_name || 'Unknown User'}</div>
                                            <div className="text-muted-foreground font-mono text-[10px] mt-1">
                                                {shiftData?.created_at ? format(new Date(shiftData.created_at), 'MMM dd, yyyy HH:mm') : 'N/A'}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Center - Timeline */}
                    <div className="col-span-6">
                        <div className="bg-card border border-border/50 rounded-2xl p-8 shadow-xl shadow-primary/5">
                            <h2 className="text-xl font-black text-foreground tracking-tight mb-8">Lifecycle Timeline</h2>
                            <div className="space-y-0">
                                {timeline.map((snapshot, index) => (
                                    <TimelineEvent
                                        key={snapshot.id || `event-${index}`}
                                        snapshot={snapshot}
                                        isLast={index === timeline.length - 1}
                                        onRevert={handleRevert}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Right Sidebar - Snapshot Viewer */}
                    <div className="col-span-3">
                        <div className="bg-card border border-border/50 rounded-2xl p-6 sticky top-28 space-y-6 shadow-xl shadow-primary/5">
                            <div>
                                <h2 className="text-[11px] font-black text-muted-foreground/50 uppercase tracking-[0.2em] mb-4">Snapshot Viewer</h2>
                                <div className="bg-muted/30 p-3 rounded-xl border border-border/50">
                                    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/70 mb-1">Viewing state after</div>
                                    <div className="text-sm text-foreground font-bold">Oct 14, 10:30 AM</div>
                                    <div className="text-[11px] font-black uppercase tracking-widest text-primary/80 mt-1">Shift Assigned</div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <button className="w-full px-4 py-3 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-sm font-bold tracking-tight border border-emerald-500/20 transition-all flex items-center justify-between group">
                                    <span className="flex items-center gap-3">
                                        <CheckCircle className="w-4 h-4" />
                                        Compliance
                                    </span>
                                    <ChevronRight className="w-4 h-4 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                                </button>

                                <button className="w-full px-4 py-3 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-sm font-bold tracking-tight border border-primary/20 transition-all flex items-center justify-between group">
                                    <span className="flex items-center gap-3">
                                        <Calendar className="w-4 h-4" />
                                        Payroll
                                    </span>
                                    <ChevronRight className="w-4 h-4 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                                </button>

                                <button className="w-full px-4 py-3 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 text-sm font-bold tracking-tight border border-amber-500/20 transition-all flex items-center justify-between group">
                                    <span className="flex items-center gap-3">
                                        <Clock className="w-4 h-4" />
                                        Timesheet
                                    </span>
                                    <ChevronRight className="w-4 h-4 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                                </button>
                            </div>

                            <div className="pt-6 border-t border-border/50">
                                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 mb-3">System Notes</div>
                                <div className="bg-muted/30 rounded-xl p-4 text-xs text-muted-foreground border border-border/50">
                                    <div className="font-bold text-foreground mb-1.5 text-sm tracking-tight">Transfer: Assignment by Manager</div>
                                    <div className="text-muted-foreground/80 font-medium">Manual Assignment by Manager</div>
                                    <div className="mt-3 text-muted-foreground/60 font-mono text-[10px] bg-background/50 inline-block px-2 py-1 rounded-md border border-border/50">Reference: REF-32474</div>
                                </div>
                            </div>

                            <div className="pt-6 border-t border-border/50">
                                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 mb-3">Override Flag</div>
                                <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4">
                                    <div className="flex items-center gap-2 text-xs text-destructive font-black tracking-widest mb-1.5">
                                        <AlertTriangle className="w-4 h-4" />
                                        YES (Code: WH)
                                    </div>
                                    <div className="text-xs text-destructive/70 font-medium">Hidden from Employee</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* JSON Source Modal */}
            {showJsonModal && (
                <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-6">
                    <div className="bg-card border border-border rounded-2xl w-full max-w-4xl max-h-[80vh] flex flex-col shadow-2xl">
                        {/* Modal Header */}
                        <div className="flex items-center justify-between p-6 border-b border-border/50 bg-muted/20">
                            <h2 className="text-xl font-black text-foreground tracking-tight">Shift JSON Source</h2>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(
                                            JSON.stringify(
                                                {
                                                    shift: shiftData,
                                                    timeline: timeline,
                                                },
                                                null,
                                                2
                                            )
                                        );
                                        alert('JSON copied to clipboard!');
                                    }}
                                    className="px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 transition-all text-[11px] font-black uppercase tracking-widest text-primary-foreground shadow-lg shadow-primary/20"
                                >
                                    Copy JSON
                                </button>
                                <button
                                    onClick={() => setShowJsonModal(false)}
                                    className="px-4 py-2 rounded-xl bg-muted/40 hover:bg-muted transition-all text-[11px] font-black uppercase tracking-widest text-foreground border border-border/50"
                                >
                                    Close
                                </button>
                            </div>
                        </div>

                        {/* Modal Content */}
                        <div className="flex-1 overflow-auto p-6 bg-muted/10">
                            <pre className="text-xs text-foreground/80 font-mono bg-card rounded-xl border border-border/50 p-6 overflow-x-auto shadow-inner">
                                {JSON.stringify(
                                    {
                                        shift: shiftData,
                                        timeline: timeline,
                                        metadata: {
                                            shiftId: shiftId,
                                            fetchedAt: new Date().toISOString(),
                                            timelineEvents: timeline.length,
                                        },
                                    },
                                    null,
                                    2
                                )}
                            </pre>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ShiftDetailView;

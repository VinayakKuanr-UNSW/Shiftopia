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
            <div className="min-h-screen bg-[#0A0E1A] flex items-center justify-center text-white">
                Loading shift audit trail...
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0A0E1A] text-white">
            {/* Header */}
            <div className="bg-gray-900/50 border-b border-gray-800 p-4">
                <div className="flex items-center justify-between max-w-7xl mx-auto">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => startTransition(() => navigate('/audit'))}
                            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back to Dashboard
                        </button>
                        <div className="h-6 w-px bg-gray-700" />
                        <h1 className="text-xl font-bold">Shift #{shiftId?.slice(0, 6)}</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => {
                                // Navigate to the shifts roster page with this shift
                                startTransition(() => {
                                    navigate(`/rosters?shiftId=${shiftId}`);
                                });
                            }}
                            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors text-sm"
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
                            className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors text-sm"
                        >
                            Go to Latest Event
                        </button>
                        <button
                            onClick={() => setShowJsonModal(true)}
                            className="px-3 py-1.5 rounded-lg border border-gray-700 hover:bg-gray-800 transition-colors text-sm"
                        >
                            View JSON Source
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto p-6">
                <div className="grid grid-cols-12 gap-6">
                    {/* Left Sidebar - Current Snapshot */}
                    <div className="col-span-3">
                        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 sticky top-6">
                            <h2 className="text-sm font-semibold text-gray-400 uppercase mb-4">Current Status</h2>

                            <div className="space-y-4">
                                <div>
                                    <span className={`inline-flex items-center px-2 py-1 rounded-md text-sm font-medium ${shiftData?.lifecycle_status === 'draft'
                                        ? 'bg-gray-500/20 text-gray-300'
                                        : shiftData?.lifecycle_status === 'published'
                                            ? 'bg-blue-500/20 text-blue-300'
                                            : shiftData?.assigned_employee_id
                                                ? 'bg-green-500/20 text-green-300'
                                                : 'bg-yellow-500/20 text-yellow-300'
                                        }`}>
                                        ● {shiftData?.assigned_employee_id ? 'Assigned' : shiftData?.lifecycle_status || 'Draft'}
                                    </span>
                                </div>

                                <div>
                                    <div className="text-xs text-gray-500 mb-1">Role</div>
                                    <div className="text-sm text-white font-medium">{shiftData?.role_name || 'N/A'}</div>
                                </div>

                                <div>
                                    <div className="text-xs text-gray-500 mb-1">Date & Time</div>
                                    <div className="text-sm text-white">
                                        {shiftData?.shift_date ? format(new Date(shiftData.shift_date), 'MMM dd, yyyy') : 'N/A'}
                                    </div>
                                    <div className="text-sm text-gray-400">
                                        {shiftData?.start_time && shiftData?.end_time
                                            ? `${shiftData.start_time.slice(0, 5)} - ${shiftData.end_time.slice(0, 5)}`
                                            : 'N/A'
                                        }
                                    </div>
                                </div>

                                {shiftData?.organization_name && (
                                    <div>
                                        <div className="text-xs text-gray-500 mb-1">Location</div>
                                        <div className="text-sm text-white">
                                            {shiftData.organization_name}
                                            {shiftData.department_name && ` > ${shiftData.department_name}`}
                                            {shiftData.sub_department_name && ` > ${shiftData.sub_department_name}`}
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <div className="text-xs text-gray-500 mb-1">Current Owner</div>
                                    {shiftData?.assigned_employee_name ? (
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold">
                                                {shiftData.assigned_employee_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                            </div>
                                            <div className="text-sm text-white">{shiftData.assigned_employee_name}</div>
                                        </div>
                                    ) : (
                                        <div className="text-sm text-gray-400 italic">Unassigned</div>
                                    )}
                                </div>

                                <div className="border-t border-gray-700 pt-4">
                                    <div className="text-xs text-gray-500 mb-2">System Metadata</div>

                                    <div className="text-xs space-y-2">
                                        <div>
                                            <div className="text-gray-500">Created by</div>
                                            <div className="text-white">{shiftData?.creator_name || 'Unknown User'}</div>
                                            <div className="text-gray-500">
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
                        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                            <h2 className="text-lg font-semibold mb-6">Lifecycle Timeline</h2>
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
                        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 sticky top-6 space-y-4">
                            <div>
                                <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3">Snapshot Viewer</h2>
                                <div className="text-xs text-gray-500 mb-2">Viewing state after</div>
                                <div className="text-sm text-white font-medium">Oct 14, 10:30 AM</div>
                                <div className="text-xs text-gray-500">Shift Assigned</div>
                            </div>

                            <div className="space-y-2">
                                <button className="w-full px-3 py-2 rounded-lg bg-green-500/20 text-green-300 text-sm border border-green-500/30 flex items-center justify-between">
                                    <span className="flex items-center gap-2">
                                        <CheckCircle className="w-4 h-4" />
                                        Compliance
                                    </span>
                                    <ChevronRight className="w-4 h-4" />
                                </button>

                                <button className="w-full px-3 py-2 rounded-lg bg-blue-500/20 text-blue-300 text-sm border border-blue-500/30 flex items-center justify-between">
                                    <span className="flex items-center gap-2">
                                        <Calendar className="w-4 h-4" />
                                        Payroll
                                    </span>
                                    <ChevronRight className="w-4 h-4" />
                                </button>

                                <button className="w-full px-3 py-2 rounded-lg bg-yellow-500/20 text-yellow-300 text-sm border border-yellow-500/30 flex items-center justify-between">
                                    <span className="flex items-center gap-2">
                                        <Clock className="w-4 h-4" />
                                        Timesheet
                                    </span>
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>

                            <div className="pt-4 border-t border-gray-800">
                                <div className="text-xs font-semibold text-gray-400 uppercase mb-2">System Notes</div>
                                <div className="bg-gray-800/50 rounded-lg p-3 text-xs text-gray-300">
                                    <div className="font-medium mb-1">Transfer: Assignment by Manager</div>
                                    <div className="text-gray-500">Manual Assignment by Manager</div>
                                    <div className="mt-2 text-gray-500">Reference: REF-32474</div>
                                </div>
                            </div>

                            <div className="pt-4 border-t border-gray-800">
                                <div className="text-xs font-semibold text-gray-400 uppercase mb-2">Override Flag</div>
                                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                                    <div className="flex items-center gap-2 text-xs text-red-400 font-medium mb-1">
                                        <AlertTriangle className="w-3 h-3" />
                                        YES (Code: WH)
                                    </div>
                                    <div className="text-xs text-gray-400">Hidden from Employee</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* JSON Source Modal */}
            {showJsonModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6">
                    <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-4xl max-h-[80vh] flex flex-col">
                        {/* Modal Header */}
                        <div className="flex items-center justify-between p-4 border-b border-gray-700">
                            <h2 className="text-lg font-semibold text-white">Shift JSON Source</h2>
                            <div className="flex items-center gap-2">
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
                                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors text-sm text-white"
                                >
                                    Copy JSON
                                </button>
                                <button
                                    onClick={() => setShowJsonModal(false)}
                                    className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors text-sm text-white"
                                >
                                    Close
                                </button>
                            </div>
                        </div>

                        {/* Modal Content */}
                        <div className="flex-1 overflow-auto p-4">
                            <pre className="text-xs text-gray-300 font-mono bg-gray-950 rounded-lg p-4 overflow-x-auto">
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

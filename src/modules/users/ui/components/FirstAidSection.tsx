import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { HeartPulse, Plus, Trash2, CalendarX2, AlertTriangle, ShieldCheck, Loader2 } from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Label } from '@/modules/core/ui/primitives/label';
import { Input } from '@/modules/core/ui/primitives/input';
import { Textarea } from '@/modules/core/ui/primitives/textarea';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/modules/core/ui/primitives/dialog';
import { cn } from '@/modules/core/lib/utils';
import { todayISO } from '@/modules/core/lib/date.utils';
import {
    allowedActions,
    appointmentStatus,
    validateEndDate,
    validateNewAppointment,
    type FirstAidAppointment,
    type FirstAidQualification,
} from '@/modules/users/domain/firstAidAppointment';
import {
    useCanManageFirstAid,
    useCreateFirstAidAppointment,
    useDeleteFirstAidAppointment,
    useEmployeeOrganisations,
    useEndFirstAidAppointment,
    useFirstAidAppointments,
    useFirstAidQualifications,
} from '@/modules/users/hooks/useFirstAidAppointments';

interface FirstAidSectionProps {
    employeeId: string;
    employeeName?: string;
}

const formatDay = (iso: string) => format(parseISO(iso), 'd MMM yyyy');

const STATUS_BADGE: Record<ReturnType<typeof appointmentStatus>, { label: string; className: string }> = {
    current:   { label: 'Appointed', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
    scheduled: { label: 'Scheduled', className: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20' },
    ended:     { label: 'Ended',     className: 'bg-muted text-muted-foreground border-border/40' },
};

const QualificationNotice: React.FC<{ qualifications: FirstAidQualification[] | undefined }> = ({ qualifications }) => {
    if (!qualifications) return null;
    if (qualifications.length === 0) {
        return (
            <div role="note" className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                    No current first-aid licence or skill on record. cl 28.2 requires a first-aid qualification,
                    so sight the certificate before appointing. The allowance still follows the appointment.
                </span>
            </div>
        );
    }
    return (
        <div className="flex gap-2 rounded-xl border border-border/30 bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span>
                Qualification on record:{' '}
                {qualifications.map((q, i) => (
                    <span key={`${q.source}-${q.name}-${i}`} className="font-semibold text-foreground">
                        {i > 0 && ', '}{q.name}{q.expires ? ` (expires ${formatDay(q.expires)})` : ''}
                    </span>
                ))}
            </span>
        </div>
    );
};

const FirstAidSection: React.FC<FirstAidSectionProps> = ({ employeeId, employeeName = 'this person' }) => {
    const today = todayISO();

    const { data: appointments, isLoading } = useFirstAidAppointments(employeeId);
    const { data: organisations } = useEmployeeOrganisations(employeeId);
    const { data: qualifications } = useFirstAidQualifications(employeeId, today);

    const [organisationId, setOrganisationId] = useState<string | null>(null);
    const activeOrgId = organisationId ?? organisations?.[0]?.id ?? null;
    const { data: canManage } = useCanManageFirstAid(employeeId, activeOrgId);

    const createAppointment = useCreateFirstAidAppointment();
    const endAppointment = useEndFirstAidAppointment();
    const deleteAppointment = useDeleteFirstAidAppointment();

    const [adding, setAdding] = useState(false);
    const [from, setFrom] = useState(today);
    const [to, setTo] = useState('');
    const [notes, setNotes] = useState('');
    const [ending, setEnding] = useState<FirstAidAppointment | null>(null);
    const [endDate, setEndDate] = useState(today);

    const isAppointedToday = useMemo(
        () => (appointments ?? []).some(a => appointmentStatus(a, today) === 'current'),
        [appointments, today],
    );

    const addError = adding && activeOrgId
        ? validateNewAppointment({ organizationId: activeOrgId, from, to: to || null }, appointments ?? [])
        : null;
    const endError = ending ? validateEndDate(ending, endDate, today) : null;

    const openAdd = () => { setFrom(today); setTo(''); setNotes(''); setAdding(true); };

    const submitAdd = async () => {
        if (!activeOrgId || addError) return;
        try {
            await createAppointment.mutateAsync({
                organization_id: activeOrgId,
                employee_id: employeeId,
                effective_from: from,
                effective_to: to || null,
                notes: notes.trim() || null,
            });
            setAdding(false);
        } catch { /* toast raised by the hook */ }
    };

    const submitEnd = async () => {
        if (!ending || endError) return;
        try {
            await endAppointment.mutateAsync({ id: ending.id, employeeId, effectiveTo: endDate });
            setEnding(null);
        } catch { /* toast raised by the hook */ }
    };

    const handleDelete = (a: FirstAidAppointment) => {
        if (confirm(`Remove the first-aid appointment starting ${formatDay(a.effective_from)}?`)) {
            deleteAppointment.mutate({ id: a.id, employeeId });
        }
    };

    return (
        <div className="bg-card border border-border/30 rounded-2xl overflow-hidden flex flex-col h-[420px] shadow-xs">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-border/20 bg-card flex items-center justify-between gap-2 shrink-0">
                <div className="space-y-0.5 min-w-0">
                    <h3 className="text-sm font-black uppercase tracking-wider text-foreground flex items-center gap-2">
                        <HeartPulse className="w-4 h-4 text-primary" aria-hidden="true" />
                        First Aid
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                        {isAppointedToday ? 'Appointed first aider' : 'Not appointed'} · allowance per ordinary hour · cl 28.2
                    </p>
                </div>
                {canManage && (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={openAdd}
                        aria-label={`Appoint ${employeeName} as a first aider`}
                        className="rounded-xl h-8 px-3 text-[10px] font-black uppercase tracking-wider shrink-0"
                    >
                        <Plus className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                        Appoint
                    </Button>
                )}
            </div>

            {/* Body */}
            <div className="p-4 flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-2.5">
                <QualificationNotice qualifications={qualifications} />

                {organisations && organisations.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">
                        No active contract, so there is no organisation to appoint them in.
                    </p>
                )}

                {isLoading ? (
                    <p className="text-muted-foreground text-xs font-medium animate-pulse py-6 text-center">Loading appointments…</p>
                ) : !appointments || appointments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                        <HeartPulse className="w-8 h-8 mx-auto mb-2 opacity-20" aria-hidden="true" />
                        <p className="text-xs font-bold">Never appointed as a first aider</p>
                    </div>
                ) : (
                    <ul className="space-y-2.5" aria-label="First-aid appointments">
                        {appointments.map(a => {
                            const status = appointmentStatus(a, today);
                            const actions = allowedActions(a, today);
                            const appointer = [a.appointer?.first_name, a.appointer?.last_name].filter(Boolean).join(' ');
                            return (
                                <li
                                    key={a.id}
                                    className="bg-muted/30 hover:bg-muted/60 rounded-xl border border-border/20 p-3 transition-colors flex items-start justify-between gap-2"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="font-bold text-xs text-foreground">
                                            {formatDay(a.effective_from)} – {a.effective_to ? formatDay(a.effective_to) : 'until ended'}
                                        </p>
                                        {appointer && (
                                            <p className="text-[11px] text-muted-foreground mt-0.5">Appointed by {appointer}</p>
                                        )}
                                        {a.notes && (
                                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate" title={a.notes}>{a.notes}</p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <Badge className={cn('border font-bold text-[9px] uppercase shadow-none', STATUS_BADGE[status].className)}>
                                            {STATUS_BADGE[status].label}
                                        </Badge>
                                        {canManage && actions.canEnd && (
                                            <button
                                                type="button"
                                                onClick={() => { setEndDate(today); setEnding(a); }}
                                                aria-label={`End the first-aid appointment starting ${formatDay(a.effective_from)}`}
                                                title="End appointment"
                                                className="text-muted-foreground/60 hover:text-primary p-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                                            >
                                                <CalendarX2 className="w-3.5 h-3.5" aria-hidden="true" />
                                            </button>
                                        )}
                                        {canManage && actions.canDelete && (
                                            <button
                                                type="button"
                                                onClick={() => handleDelete(a)}
                                                aria-label={`Remove the scheduled first-aid appointment starting ${formatDay(a.effective_from)}`}
                                                title="Remove scheduled appointment"
                                                className="text-muted-foreground/60 hover:text-red-500 p-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                            </button>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {/* Appoint dialog */}
            <Dialog open={adding} onOpenChange={setAdding}>
                <DialogContent className="rounded-2xl border border-border/30 bg-popover">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-black uppercase tracking-tight">Appoint first aider</DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                            {employeeName} will be paid the first-aid allowance on every ordinary hour they work
                            while the appointment is in force (cl 28.2).
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 mt-2">
                        <QualificationNotice qualifications={qualifications} />
                        {organisations && organisations.length > 1 && (
                            <div>
                                <Label htmlFor="fa-org" className="text-xs font-bold">Organisation</Label>
                                <select
                                    id="fa-org"
                                    value={activeOrgId ?? ''}
                                    onChange={e => setOrganisationId(e.target.value)}
                                    className="mt-1 w-full rounded-xl border border-border/40 bg-background px-3 py-2 text-sm"
                                >
                                    {organisations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                </select>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label htmlFor="fa-from" className="text-xs font-bold">Starts <span className="text-red-500">*</span></Label>
                                <Input id="fa-from" type="date" required value={from} onChange={e => setFrom(e.target.value)} className="rounded-xl border-border/40" />
                            </div>
                            <div>
                                <Label htmlFor="fa-to" className="text-xs font-bold">Last day (optional)</Label>
                                <Input id="fa-to" type="date" min={from} value={to} onChange={e => setTo(e.target.value)} className="rounded-xl border-border/40" />
                            </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground -mt-2">
                            Leave the last day empty for an ongoing appointment. For a single event, use the same date twice.
                        </p>
                        <div>
                            <Label htmlFor="fa-notes" className="text-xs font-bold">Notes (optional)</Label>
                            <Textarea id="fa-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                                placeholder="e.g. certificate sighted, event name" className="rounded-xl border-border/40 text-sm" />
                        </div>
                        {addError && <p role="alert" className="text-[11px] font-semibold text-red-600 dark:text-red-400">{addError}</p>}
                        <Button
                            onClick={submitAdd}
                            disabled={!!addError || !activeOrgId || createAppointment.isPending}
                            className="w-full rounded-xl font-bold uppercase tracking-wider shadow-none"
                        >
                            {createAppointment.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                            Appoint
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* End dialog */}
            <Dialog open={!!ending} onOpenChange={open => !open && setEnding(null)}>
                <DialogContent className="rounded-2xl border border-border/30 bg-popover">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-black uppercase tracking-tight">End appointment</DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                            Choose the last day the allowance applies. Pick yesterday to stop it from today.
                            Earlier dates are locked because those shifts have already been worked and priced.
                        </DialogDescription>
                    </DialogHeader>
                    {ending && (
                        <div className="space-y-4 mt-2">
                            <div>
                                <Label htmlFor="fa-end" className="text-xs font-bold">Last day</Label>
                                <Input
                                    id="fa-end"
                                    type="date"
                                    min={allowedActions(ending, today).earliestEnd ?? undefined}
                                    value={endDate}
                                    onChange={e => setEndDate(e.target.value)}
                                    className="rounded-xl border-border/40"
                                />
                            </div>
                            {endError && <p role="alert" className="text-[11px] font-semibold text-red-600 dark:text-red-400">{endError}</p>}
                            <Button
                                onClick={submitEnd}
                                disabled={!!endError || endAppointment.isPending}
                                className="w-full rounded-xl font-bold uppercase tracking-wider shadow-none"
                            >
                                {endAppointment.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                                End appointment
                            </Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default FirstAidSection;

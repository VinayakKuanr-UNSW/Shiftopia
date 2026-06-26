/**
 * ShiftWizardModal — centered Add/Edit Shift wizard, ON TOP of the roster grid.
 *
 * A CUSTOM overlay (NOT a Radix Dialog) so `document.body` is never set
 * inert / pointer-events:none — the form's nested Select / Popover / Command
 * dropdowns (all z-50, portaled to body) keep working. The overlay sits at z-40
 * so those dropdowns layer above it.
 *
 * Mounted once in RostersPlannerPage; opened from anywhere via
 * useShiftFormNav() → useShiftFormModalStore. Reuses the exact same orchestrator
 * + render layer (ShiftFormDrawerContent) as the legacy page, so all business
 * logic (compliance, validation, submit, the wizard steps) is unchanged.
 */

import React from 'react';
import {
    Loader2, X, Plus, Save, Undo2, Zap,
    CalendarPlus, CalendarCheck,
} from 'lucide-react';

import { Form } from '@/modules/core/ui/primitives/form';
import { Button } from '@/modules/core/ui/primitives/button';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

import { ShiftFormDrawerContent } from './components/ShiftFormDrawerContent';
import { CancelConfirmDialog } from './components';
import { useShiftFormOrchestrator } from './hooks/useShiftFormOrchestrator';
import { useShiftFormModalStore, type OpenShiftFormOptions } from '../../../state/useShiftFormModalStore';

// ── Host: reads the store, mounts the wizard only while open ─────────────────
export const ShiftWizardModal: React.FC = () => {
    const isOpen = useShiftFormModalStore((s) => s.isOpen);
    const opts = useShiftFormModalStore((s) => s.opts);
    const close = useShiftFormModalStore((s) => s.close);

    if (!isOpen || !opts) return null;
    // Keyed so switching from create → edit (or a different shift) remounts the
    // orchestrator with fresh form state.
    return (
        <ShiftWizardModalInner
            key={opts.existingShift?.id ?? 'new'}
            opts={opts}
            onClose={close}
        />
    );
};

// ── Inner: orchestrator + overlay UI (only mounted while open) ───────────────
const ShiftWizardModalInner: React.FC<{ opts: OpenShiftFormOptions; onClose: () => void }> = ({
    opts,
    onClose,
}) => {
    const { isDark } = useTheme();
    const isTemplateMode = opts.isTemplateMode ?? false;
    const editMode = opts.editMode ?? false;

    const {
        form,
        isLoading,
        showCancelConfirm,
        setShowCancelConfirm,

        // Data
        roles, remunerationLevels, employees, skills, licenses, events,
        rosters, rosterStructure, activeSubGroups, isLoadingData,

        // Context
        resolvedContext,

        // Statuses
        isAssignmentEnabled, minShiftHours,

        // Values
        shiftLength, netLength,

        // Locks
        isGroupLocked, isSubGroupLocked, isRoleLocked, isEmployeeLocked,

        // Read-only
        isPast, isStarted, isPublished, isReadOnly,

        // Roster
        selectedRosterId, setSelectedRosterId,

        // Validation
        canSave, hardValidation, isLoadingShifts,

        // Compliance
        compliancePanel, runChecks,

        // Emergency state
        isEmergencyAssignment, isScheduleDefined,

        // Handlers
        handleSubmit, handleCancel, handleUnpublish, canUnpublish,
    } = useShiftFormOrchestrator({
        isOpen: true,
        onClose,
        context: opts.context ?? null,
        editMode,
        existingShift: opts.existingShift,
        isTemplateMode,
    });

    // Esc closes (routes through the cancel-confirm guard).
    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); handleCancel(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [handleCancel]);

    const surface = isReadOnly
        ? 'bg-[#0a0a0c] border-slate-800/50'
        : isPublished
            ? 'bg-[#0c0512] border-purple-900/30 shadow-2xl'
            : isEmergencyAssignment
                ? 'bg-[#0c0506] border-red-500/25 shadow-2xl'
                : 'bg-card dark:bg-[#0a0c10] border-border/50 shadow-2xl';

    const primaryLabel = isEmergencyAssignment
        ? (editMode ? 'Emergency Update' : 'Emergency Assign')
        : (editMode ? 'Update Shift' : isPublished ? 'Publish Shift' : 'Create Shift');

    return (
        <>
            {/* Backdrop — click does NOT close (explicit X/Cancel/Esc only). z-40 so
                the form's z-50 dropdowns portal above the modal. */}
            <div
                className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in-0 duration-200"
                role="dialog"
                aria-modal="true"
                aria-label={editMode ? 'Edit Shift' : 'Create Shift'}
            >
                <div
                    className={cn(
                        'relative flex w-full max-w-[1040px] max-h-[90vh] flex-col overflow-hidden rounded-3xl border shadow-2xl shadow-black/40 transition-all animate-in zoom-in-95 duration-200',
                        surface,
                    )}
                >
                    {/* ── MODAL ACTION BAR ── */}
                    <div className={cn(
                        'flex flex-shrink-0 items-center justify-between gap-2 border-b px-4 py-2.5 sm:px-5',
                        isDark ? 'border-white/5 bg-[#0c0e14]/80' : 'border-border/50 bg-card/80',
                        'backdrop-blur-xl',
                    )}>
                        <div className="flex items-center gap-2.5">
                            <div className={cn(
                                'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
                                isEmergencyAssignment ? 'bg-red-500/10 text-red-500'
                                    : isPublished ? 'bg-purple-500/10 text-purple-500'
                                        : 'bg-amber-500/10 text-amber-500',
                            )}>
                                {editMode ? <CalendarCheck className="h-4 w-4" /> : <CalendarPlus className="h-4 w-4" />}
                            </div>
                            <h2 className="text-sm font-black uppercase tracking-[0.14em] text-foreground/90">
                                {editMode ? 'Edit Shift' : 'Create Shift'}
                            </h2>
                        </div>

                        <div className="flex items-center gap-1.5">
                            {canUnpublish && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={handleUnpublish}
                                    className="h-9 gap-1.5 rounded-xl border border-purple-500/20 px-3 text-xs font-bold text-purple-400 transition-all hover:bg-purple-500/10 hover:text-purple-300"
                                >
                                    <Undo2 className="h-4 w-4" />
                                    <span className="hidden sm:inline">Unpublish</span>
                                </Button>
                            )}

                            {!isPublished && !isEmergencyAssignment && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => handleSubmit(form.getValues())}
                                    disabled={!canSave || isLoading}
                                    className={cn(
                                        'h-9 rounded-xl px-4 text-[10px] font-black uppercase tracking-[0.12em] transition-all',
                                        isDark ? 'border-white/10 text-white/80 hover:bg-white/5' : 'border-slate-200 text-slate-700 hover:bg-slate-100',
                                    )}
                                >
                                    Save Draft
                                </Button>
                            )}

                            <Button
                                type="button"
                                onClick={() => handleSubmit(form.getValues())}
                                disabled={!canSave || isLoading}
                                className={cn(
                                    'flex h-9 items-center gap-2 rounded-xl px-4 text-[10px] font-black uppercase tracking-[0.12em] shadow-sm transition-all sm:px-6 sm:text-xs',
                                    canSave
                                        ? isPublished
                                            ? 'border border-purple-400/20 bg-purple-600 text-white shadow-purple-500/20 hover:bg-purple-500'
                                            : isEmergencyAssignment
                                                ? 'border border-red-400/20 bg-red-600 text-white shadow-red-500/20 hover:bg-red-500'
                                                : 'border border-amber-400/20 bg-amber-600 text-white shadow-amber-500/20 hover:bg-amber-500'
                                        : 'cursor-not-allowed border border-border bg-muted text-muted-foreground opacity-60',
                                )}
                            >
                                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : isEmergencyAssignment ? <Zap className="h-4 w-4" />
                                        : editMode ? <Save className="h-3.5 w-3.5" />
                                            : <Plus className="h-3.5 w-3.5" />}
                                <span className="hidden sm:inline">{primaryLabel}</span>
                            </Button>

                            <div className="mx-0.5 h-6 w-px bg-border/30" />

                            <Button
                                type="button"
                                variant="ghost"
                                onClick={handleCancel}
                                aria-label="Close"
                                className="h-9 w-9 rounded-xl p-0 text-muted-foreground transition-all hover:bg-muted/40 hover:text-foreground"
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {/* ── BODY (wizard: left stepper + active step + Back/Next) ── */}
                    <Form {...form}>
                        <form
                            id="shift-form"
                            onSubmit={form.handleSubmit(handleSubmit)}
                            className="flex min-h-0 flex-1 flex-col overflow-hidden"
                        >
                            <ShiftFormDrawerContent
                                form={form}
                                isReadOnly={isReadOnly}
                                isPast={isPast}
                                isStarted={isStarted}
                                isPublished={isPublished}
                                isTemplateMode={isTemplateMode}
                                editMode={editMode}
                                existingShift={opts.existingShift}
                                roles={roles}
                                remunerationLevels={remunerationLevels}
                                employees={employees}
                                skills={skills}
                                licenses={licenses}
                                events={events}
                                rosters={rosters}
                                rosterStructure={rosterStructure}
                                activeSubGroups={Object.values(activeSubGroups).flat()}
                                isLoadingData={isLoadingData}
                                isLoadingShifts={isLoadingShifts}
                                resolvedContext={resolvedContext}
                                selectedRosterId={selectedRosterId}
                                setSelectedRosterId={setSelectedRosterId}
                                shiftLength={shiftLength}
                                netLength={netLength}
                                hardValidation={hardValidation}
                                isAssignmentEnabled={isAssignmentEnabled}
                                minShiftHours={minShiftHours}
                                compliancePanel={compliancePanel}
                                runV2Compliance={runChecks}
                                onUnpublish={handleUnpublish}
                                canUnpublish={canUnpublish}
                                isGroupLocked={isGroupLocked}
                                isSubGroupLocked={isSubGroupLocked}
                                isRoleLocked={isRoleLocked}
                                isEmployeeLocked={isEmployeeLocked}
                                isScheduleDefined={isScheduleDefined}
                                currentStep={1}
                            />
                        </form>
                    </Form>
                </div>
            </div>

            <CancelConfirmDialog
                open={showCancelConfirm}
                onOpenChange={setShowCancelConfirm}
                onConfirm={onClose}
            />
        </>
    );
};

export default ShiftWizardModal;

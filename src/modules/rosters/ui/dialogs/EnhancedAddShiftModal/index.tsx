/**
 * EnhancedAddShiftModal — Card-Based Layout (Unified Central Modal)
 *
 * Pure rendering layer — all business logic lives in useShiftFormOrchestrator.
 * Uses the custom z-40 overlay and top action bar so that both Rosters and
 * Templates share the exact same modal UI without popover/pointer-events issues.
 *
 * Two render layers over ONE orchestrator:
 *   · < md — ShiftFormSheet: a full-height bottom sheet, single scrolling form.
 *   · ≥ md — the 5-step wizard below.
 * The wizard's step gating is a desktop affordance (there is a stepper rail to
 * explain it); on a phone it just hides the submit button behind four taps.
 */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Form } from '@/modules/core/ui/primitives/form';
import { Button } from '@/modules/core/ui/primitives/button';
import { X, Undo2 } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useIsMobile } from '@/modules/core/hooks/use-mobile';
import { ShiftFormDrawerContent } from './components/ShiftFormDrawerContent';
import { ShiftFormSheet } from './components/ShiftFormSheet';
import { useFocusTrap } from '@/modules/core/hooks/useFocusTrap';

import type { EnhancedAddShiftModalProps } from './types';
import { useShiftFormOrchestrator } from './hooks/useShiftFormOrchestrator';

// ── Always-visible chrome ──────────────────────────────────────────────
import { CancelConfirmDialog } from './components';

// ── Component ─────────────────────────────────────────────────────────
export const EnhancedAddShiftModal: React.FC<EnhancedAddShiftModalProps> = (props) => {
    const { isOpen, onClose } = props;
    const isMobile = useIsMobile();
    const isTemplateMode = props.isTemplateMode ?? false;
    const editMode = props.editMode ?? false;

    const {
        form,
        isLoading,
        showCancelConfirm,
        setShowCancelConfirm,

        // Data
        roles,
        remunerationLevels,
        employees,
        skills,
        licenses,
        events,
        rosters,
        rosterStructure,
        activeSubGroups,
        isLoadingData,

        // Context
        resolvedContext,

        // Statuses
        isAssignmentEnabled,
        minShiftHours,
        shape,
        shapeBlockers,

        // Values
        shiftLength,
        netLength,

        // Locks
        isGroupLocked,
        isSubGroupLocked,
        isRoleLocked,
        isEmployeeLocked,
        isTargetTypeLocked,

        // Read-only
        isPast,
        isStarted,
        isPublished,
        isReadOnly,

        // Roster
        selectedRosterId,
        setSelectedRosterId,

        // Validation
        canSave,
        saveBlockReason,
        hardValidation,
        isLoadingShifts,

        // Compliance
        compliancePanel,
        runChecks,

        isScheduleDefined,

        // Handlers
        handleSubmit,
        handleCancel,
        handleUnpublish,
        canUnpublish,
    } = useShiftFormOrchestrator(props);

    // Keyboard focus containment + restore (see useFocusTrap for why the custom
    // overlay has to do this itself instead of relying on Radix).
    const dialogRef = useFocusTrap<HTMLDivElement>(isOpen);

    // Esc key handler (routes through cancel confirm if form is dirty).
    //
    // Skipped while a dropdown is open: Radix popper content closes itself on
    // Escape, and Android's hardware back arrives here as a synthetic Escape
    // (CapacitorBridge.dismissTopOverlay), so without this guard one back press
    // would close the Select AND tear down the whole form behind it.
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
            e.preventDefault();
            handleCancel();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, handleCancel]);

    if (!isOpen) return null;

    /* ── MOBILE: bottom sheet ────────────────────────────────────────────
       Keeps the planner on the roster screen — they can still see which day
       and group the shift is being added to — while the sheet gives the form
       its own focused, full-height surface. */
    if (isMobile) {
        return (
            <>
                <ShiftFormSheet
                    containerRef={dialogRef}
                    form={form}
                    isReadOnly={isReadOnly}
                    isPast={isPast}
                    isStarted={isStarted}
                    isPublished={isPublished}
                    isTemplateMode={isTemplateMode}
                    editMode={editMode}
                    existingShift={props.existingShift}
                    roles={roles}
                    employees={employees}
                    skills={skills}
                    licenses={licenses}
                    events={events}
                    rosters={rosters}
                    isLoadingData={isLoadingData}
                    isLoadingShifts={isLoadingShifts}
                    resolvedContext={resolvedContext}
                    selectedRosterId={selectedRosterId}
                    shiftLength={shiftLength}
                    netLength={netLength}
                    hardValidation={hardValidation}
                    minShiftHours={minShiftHours}
                    shape={shape}
                    shapeBlockers={shapeBlockers}
                    compliancePanel={compliancePanel}
                    isGroupLocked={isGroupLocked}
                    isSubGroupLocked={isSubGroupLocked}
                    isRoleLocked={isRoleLocked}
                    isEmployeeLocked={isEmployeeLocked}
                    isTargetTypeLocked={isTargetTypeLocked}
                    canUnpublish={canUnpublish}
                    onUnpublish={handleUnpublish}
                    canSave={canSave}
                    saveBlockReason={saveBlockReason}
                    isLoading={isLoading}
                    onSubmit={handleSubmit}
                    onCancel={handleCancel}
                />

                <CancelConfirmDialog
                    open={showCancelConfirm}
                    onOpenChange={setShowCancelConfirm}
                    onConfirm={onClose}
                />
            </>
        );
    }

    const surface = isReadOnly
        ? 'bg-card dark:bg-[#0a0a0c] border-slate-200 dark:border-slate-800/50'
        : isPublished
            ? 'bg-card dark:bg-[#0c0512] border-purple-300/40 dark:border-purple-900/30 shadow-2xl'
            : 'bg-card dark:bg-[#0c0e14] border-slate-200 dark:border-white/10 shadow-2xl';

    const subtitleText = editMode && props.existingShift?.id
        ? `#${props.existingShift.id.slice(0, 8).toUpperCase()}`
        : resolvedContext.date || 'New shift specification';

    // Portalled to <body> like every other dialog. Rendered inside <main>
    // (which is `isolate`), it was trapped beneath the fixed z-50 sidebar card,
    // which then overlapped the modal. At body level and z-50 it ties with the
    // sidebar and wins on DOM order; tooltips and popovers opened from inside
    // the form portal later still, so they stay above it.
    return createPortal(
        <>
            {/* Backdrop over the whole viewport, sidebar included. */}
            <div
                className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-200"
                role="dialog"
                aria-modal="true"
                aria-label={editMode ? 'Edit Shift' : 'Create Shift'}
                data-state="open"
            >
                <div
                    ref={dialogRef}
                    className={cn(
                        'relative flex w-full max-w-[1040px] h-[min(760px,92vh)] flex-col overflow-hidden rounded-2xl sm:rounded-3xl border shadow-2xl transition-all animate-in zoom-in-95 duration-200',
                        surface,
                    )}
                >

                    {/* ── BODY FORM ── */}
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
                                existingShift={props.existingShift}
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
                                shape={shape}
                                shapeBlockers={shapeBlockers}
                                compliancePanel={compliancePanel}
                                runV2Compliance={runChecks}
                                onUnpublish={handleUnpublish}
                                canUnpublish={canUnpublish}
                                isGroupLocked={isGroupLocked}
                                isSubGroupLocked={isSubGroupLocked}
                                isRoleLocked={isRoleLocked}
                                isEmployeeLocked={isEmployeeLocked}
                                            isTargetTypeLocked={isTargetTypeLocked}
                                isScheduleDefined={isScheduleDefined}
                                currentStep={1}
                                onCancel={handleCancel}
                                title={editMode ? 'Edit Shift' : 'Create Shift'}
                                subtitle={subtitleText}
                                headerActions={
                                    <>
                                        {canUnpublish && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                onClick={handleUnpublish}
                                                className="h-9 gap-1.5 rounded-lg border border-purple-500/20 px-3 text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:bg-purple-500/10"
                                            >
                                                <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                                                Unpublish
                                            </Button>
                                        )}
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            onClick={handleCancel}
                                            aria-label="Close dialog"
                                            className="h-9 w-9 rounded-lg p-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                                        >
                                            <X className="h-4 w-4" aria-hidden="true" />
                                        </Button>
                                    </>
                                }
                                onSubmit={handleSubmit}
                                canSave={canSave}
                                isLoading={isLoading}
                                saveBlockReason={saveBlockReason}
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
        </>,
        document.body,
    );
};

export default EnhancedAddShiftModal;
export * from './types';


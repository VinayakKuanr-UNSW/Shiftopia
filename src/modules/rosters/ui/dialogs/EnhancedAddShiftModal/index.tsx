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
import { Form } from '@/modules/core/ui/primitives/form';
import { Button } from '@/modules/core/ui/primitives/button';
import { Loader2, X, Plus, Save, Undo2, CalendarPlus, CalendarCheck } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
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
    const { isDark } = useTheme();
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

        // Emergency state
        isEmergencyAssignment,
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
        ? 'bg-[#0a0a0c] border-slate-800/50'
        : isPublished
            ? 'bg-[#0c0512] border-purple-900/30 shadow-2xl'
            : 'bg-card dark:bg-[#0a0c10] border-border/50 shadow-2xl';

    const primaryLabel = editMode ? 'Update Shift' : isPublished ? 'Publish Shift' : 'Create Shift';

    return (
        <>
            {/* Backdrop overlay (z-40 so nested z-50 select dropdowns portal above) */}
            <div
                className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in-0 duration-200"
                role="dialog"
                aria-modal="true"
                aria-label={editMode ? 'Edit Shift' : 'Create Shift'}
                // Radix stamps this on its own dialogs; CapacitorBridge's
                // dismissTopOverlay selects on it to route Android back here
                // instead of navigating the router out from under an open form.
                data-state="open"
            >
                <div
                    ref={dialogRef}
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
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-500">
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

                            {/* The primary action disables on six different conditions.
                                Without a stated reason it is a dead end, so the next
                                required action is rendered beside it and wired to the
                                button via aria-describedby. */}
                            <div className="flex items-center gap-2">
                                {!canSave && saveBlockReason && !isLoading && (
                                    <p
                                        id="save-block-reason"
                                        className="hidden max-w-[22rem] truncate text-right text-[11px] font-medium text-muted-foreground md:block"
                                        title={saveBlockReason}
                                    >
                                        {saveBlockReason}
                                    </p>
                                )}
                                <Button
                                    type="button"
                                    onClick={() => handleSubmit(form.getValues())}
                                    disabled={!canSave || isLoading}
                                    aria-describedby={!canSave && saveBlockReason ? 'save-block-reason' : undefined}
                                    title={!canSave && saveBlockReason ? saveBlockReason : undefined}
                                    className={cn(
                                        'flex h-9 items-center gap-2 rounded-xl px-4 text-[10px] font-black uppercase tracking-[0.12em] shadow-sm transition-all sm:px-6 sm:text-xs',
                                        canSave
                                            ? 'border border-purple-400/20 bg-purple-600 text-white shadow-purple-500/20 hover:bg-purple-500 active:bg-purple-700 focus-visible:ring-2 focus-visible:ring-purple-400'
                                            : 'cursor-not-allowed border border-border bg-muted text-muted-foreground opacity-60',
                                    )}
                                >
                                    {isLoading ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : editMode ? (
                                        <Save className="h-3.5 w-3.5" />
                                    ) : (
                                        <Plus className="h-3.5 w-3.5" />
                                    )}
                                    <span className="hidden sm:inline">{primaryLabel}</span>
                                </Button>
                            </div>

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

                    {/* ── BODY ── */}
                    <Form {...form}>
                        <form
                            id="shift-form"
                            onSubmit={form.handleSubmit(handleSubmit)}
                            className="flex min-h-0 flex-1 flex-col overflow-hidden"
                        >
                            {/* ── Card grid ── */}
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

export default EnhancedAddShiftModal;
export * from './types';


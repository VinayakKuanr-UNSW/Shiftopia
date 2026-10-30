/**
 * ShiftFormPage — Full-page Add / Edit Shift
 *
 * Dedicated route (/rosters/shift/new) that replaces the old centered Dialog.
 * Because there is NO Radix Dialog wrapping the form, the body is never
 * pointer-events:none, so all nested Select / Popover / Command dropdowns work
 * natively with zero modal-layering conflicts.
 *
 * Launch context (org/dept/group/role/date/rosterId, editMode, existingShift)
 * is passed via router location state by the launcher (e.g. DrillDownPanel).
 * Reuses the exact same orchestrator + render layer as the modal did, so all
 * business logic (compliance, validation, submit) is unchanged.
 */

import React from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Loader2, X, Plus, Save, Undo2, Zap } from 'lucide-react';

import { Form } from '@/modules/core/ui/primitives/form';
import { cn } from '@/modules/core/lib/utils';
import { surface } from '@/modules/core/ui/layout/pageTokens';


import { GoldStandardHeader } from '@/modules/core/ui/components/GoldStandardHeader';
import { PageLayout } from '@/modules/core/ui/layout/PageLayout';
import { ToolbarRow, toolbar } from '@/modules/core/ui/components/Toolbar';
import { CalendarPlus, CalendarCheck } from 'lucide-react';
import { ShiftFormDrawerContent } from '../ui/dialogs/EnhancedAddShiftModal/components/ShiftFormDrawerContent';
import { CancelConfirmDialog } from '../ui/dialogs/EnhancedAddShiftModal/components';
import { useShiftFormOrchestrator } from '../ui/dialogs/EnhancedAddShiftModal/hooks/useShiftFormOrchestrator';
import type { ShiftContext } from '../ui/dialogs/EnhancedAddShiftModal/types';

interface ShiftFormPageState {
    context?: ShiftContext | null;
    editMode?: boolean;
    existingShift?: any;
    isTemplateMode?: boolean;
}

const ShiftFormPage: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const state = (location.state ?? null) as ShiftFormPageState | null;

    const hasContext = !!state?.context;
    const editMode = state?.editMode ?? false;
    const isTemplateMode = state?.isTemplateMode ?? false;

    // Return to the roster grid. The shift mutations already invalidate the
    // roster queries, so the grid refetches on arrival.
    const goBack = React.useCallback(() => navigate('/rosters'), [navigate]);

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
    } = useShiftFormOrchestrator({
        isOpen: hasContext,
        onClose: goBack,
        context: state?.context ?? null,
        editMode,
        existingShift: state?.existingShift,
        isTemplateMode,
    });

    // Guard: page reached without launch context (e.g. hard refresh / deep link).
    // Hook is always called above, so this conditional return is hooks-safe.
    if (!hasContext) {
        return <Navigate to="/rosters" replace />;
    }

    return (
        <PageLayout
            className={cn(
                isReadOnly
                    ? 'bg-[#0a0a0c]'
                    : isPublished
                        ? 'bg-[#0c0512]'
                        : 'bg-card dark:bg-[#0a0c10]',
            )}
        >
            
            {/* ── GOLD STANDARD HEADER ── */}
            <GoldStandardHeader
                title={editMode ? 'Edit Shift' : 'Create Shift'}
                Icon={editMode ? CalendarCheck : CalendarPlus}
                functionBar={
                    <ToolbarRow
                        actions={<>
                            <button type="button" onClick={handleCancel} aria-label="Cancel" className={toolbar.secondaryAction}>
                                <X className="h-4 w-4" aria-hidden="true" />
                                <span className="hidden sm:inline">Cancel</span>
                            </button>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.preventDefault();
                                    runChecks();
                                }}
                                aria-label="Run compliance"
                                className={toolbar.secondaryAction}
                            >
                                <Zap className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden="true" />
                                <span className="hidden sm:inline">Run Compliance</span>
                            </button>
                            {canUnpublish && (
                                <button type="button" onClick={handleUnpublish} className={toolbar.secondaryAction}>
                                    <Undo2 className="h-4 w-4 text-purple-600 dark:text-purple-400" aria-hidden="true" />
                                    Unpublish
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => {
                                    handleSubmit(form.getValues());
                                }}
                                disabled={!canSave || isLoading}
                                // Purple = published, amber = draft: the shift-state colours used across the app.
                                className={cn(
                                    toolbar.primaryAction,
                                    isPublished
                                        ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-500/20'
                                        : 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-500/20',
                                )}
                            >
                                {isLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                ) : editMode ? (
                                    <Save className="h-3.5 w-3.5" aria-hidden="true" />
                                ) : (
                                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                )}
                                {editMode ? 'Update Shift' : isPublished ? 'Publish Shift' : 'Create Shift'}
                            </button>
                        </>}
                    />
                }
            />

            {/* ── BODY ── */}
            <div className={cn(
                "flex-1 min-h-0 flex flex-col overflow-hidden",
                surface.bodyCard
            )}>
<Form {...form}>
                <form
                    id="shift-form"
                    onSubmit={form.handleSubmit(handleSubmit)}
                    className="flex-1 min-h-0 flex flex-col overflow-hidden"
                >
                    {/* ── Card grid (same render layer as the old modal) ── */}
                    <ShiftFormDrawerContent
                        form={form}
                        isReadOnly={isReadOnly}
                        isPast={isPast}
                        isStarted={isStarted}
                        isPublished={isPublished}
                        isTemplateMode={isTemplateMode}
                        editMode={editMode}
                        existingShift={state?.existingShift}
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
            <CancelConfirmDialog
                open={showCancelConfirm}
                onOpenChange={setShowCancelConfirm}
                onConfirm={goBack}
            />
        </PageLayout>
    );
};

export default ShiftFormPage;

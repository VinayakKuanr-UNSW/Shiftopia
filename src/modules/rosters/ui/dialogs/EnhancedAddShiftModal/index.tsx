/**
 * EnhancedAddShiftModal — Redesigned 3-Step Flow
 *
 * Step 1: Schedule & Details (Hierarchy, Context, Timings, Breaks, Criteria, Notes)
 * Step 2: Assignment & Compliance (Two-pane: Employee Pool + Compliance Inspector)
 * Step 3: Review Logs
 *
 * Pure rendering layer — all business logic lives in useShiftFormOrchestrator.
 * Step panels are lazy-loaded for fast initial paint.
 */

import React, { Suspense, lazy } from 'react';
import { Dialog, DialogContent } from '@/modules/core/ui/primitives/dialog';
import { Form } from '@/modules/core/ui/primitives/form';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { Loader2 } from 'lucide-react';

import type { EnhancedAddShiftModalProps } from './types';
import { useShiftFormOrchestrator } from './hooks/useShiftFormOrchestrator';

// ── Always-visible chrome (imported eagerly — zero extra latency) ──────────
import {
    ModalHeader,
    ModalFooter,
    CancelConfirmDialog,
    StepIndicator,
} from './components';

// ── Step panels (lazy) ────────────────────────────────────────────────────
const ScheduleStep = lazy(() => import('./components/ScheduleStep').then(m => ({ default: m.ScheduleStep })));
const AssignmentStep = lazy(() => import('./components/AssignmentStep').then(m => ({ default: m.AssignmentStep })));
const ReviewLogsStep = lazy(() => import('./components/ReviewLogsStep').then(m => ({ default: m.ReviewLogsStep })));

// ── Fallback while a step chunk loads ─────────────────────────────────────
function StepSkeleton() {
    return (
        <div className="flex items-center justify-center h-48">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/30" />
        </div>
    );
}

// ── Component ─────────────────────────────────────────────────────────────
export const EnhancedAddShiftModal: React.FC<EnhancedAddShiftModalProps> = (props) => {
    const { isOpen, onClose } = props;
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

        // Step navigation
        currentStep,
        completedSteps,
        handleNextStep,
        handlePrevStep,
        handleStepClick,
        isStepValid,

        // Values
        shiftLength,
        netLength,
        selectedRemLevel,

        // Locks
        isRosterLocked,
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
        derivedRosterId,

        // Validation
        canSave,
        hardValidation,

        // Compliance
        complianceResults,
        setComplianceResults,
        complianceNeedsRerun,
        buildComplianceInput,
        handleComplianceComplete,

        // Watched fields
        watchEmployeeId,

        // Handlers
        handleSubmit,
        handleCancel,
        handleUnpublish,
        canUnpublish,
    } = useShiftFormOrchestrator(props);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent
                className="sm:max-w-[1400px] h-[90vh] p-0 gap-0 bg-background border-border overflow-hidden flex flex-col"
                aria-describedby={undefined}
            >
                <ModalHeader
                    editMode={editMode}
                    isReadOnly={isReadOnly}
                    isPast={isPast}
                    isStarted={isStarted}
                    isPublished={isPublished}
                    safeContext={resolvedContext}
                    onUnpublish={handleUnpublish}
                />

                <Form {...form}>
                    <form
                        id="shift-form"
                        onSubmit={form.handleSubmit(handleSubmit)}
                        className="flex flex-col flex-1 min-h-0 overflow-hidden"
                    >
                        {/* Step indicator */}
                        <div className="px-6 pt-4 pb-6 border-b border-border">
                            <StepIndicator
                                currentStep={currentStep}
                                completedSteps={completedSteps}
                                onStepClick={handleStepClick}
                                disabled={isReadOnly}
                                editMode={editMode}
                            />
                        </div>

                        {/* Step panel — lazy-loaded */}
                        <ScrollArea className="flex-1">
                            <div className="px-6 py-6">
                                <Suspense fallback={<StepSkeleton />}>
                                    {currentStep === 1 && (
                                        <ScheduleStep
                                            form={form}
                                            isReadOnly={isReadOnly}
                                            isLoadingData={isLoadingData}
                                            isTemplateMode={isTemplateMode}
                                            shiftLength={shiftLength}
                                            netLength={netLength}
                                            hardValidation={hardValidation}
                                            rosters={rosters}
                                            rosterStructure={rosterStructure}
                                            selectedRosterId={selectedRosterId}
                                            onRosterChange={setSelectedRosterId}
                                            isGroupLocked={isGroupLocked}
                                            isSubGroupLocked={isSubGroupLocked}
                                            isRosterLocked={isRosterLocked}
                                            context={resolvedContext}
                                            activeSubGroups={activeSubGroups}
                                            // Column 5 props
                                            roles={roles}
                                            remunerationLevels={remunerationLevels}
                                            skills={skills}
                                            licenses={licenses}
                                            events={events}
                                            selectedRemLevel={selectedRemLevel}
                                            isRoleLocked={isRoleLocked}
                                        />
                                    )}

                                    {currentStep === 2 && (
                                        <AssignmentStep
                                            form={form}
                                            isReadOnly={isReadOnly}
                                            isLoadingData={isLoadingData}
                                            isTemplateMode={isTemplateMode}
                                            employees={employees}
                                            isEmployeeLocked={isEmployeeLocked}
                                            existingShift={props.existingShift}
                                            watchEmployeeId={watchEmployeeId}
                                            hardValidation={hardValidation}
                                            complianceResults={complianceResults}
                                            setComplianceResults={setComplianceResults}
                                            buildComplianceInput={buildComplianceInput}
                                            complianceNeedsRerun={complianceNeedsRerun}
                                            onChecksComplete={handleComplianceComplete}
                                        />
                                    )}

                                    {currentStep === 3 && (
                                        <ReviewLogsStep
                                            form={form}
                                            editMode={editMode}
                                            existingShift={props.existingShift}
                                            safeContext={resolvedContext}
                                            selectedRosterId={derivedRosterId || ''}
                                            shiftLength={shiftLength}
                                            netLength={netLength}
                                        />
                                    )}
                                </Suspense>
                            </div>
                        </ScrollArea>
                    </form>
                </Form>

                <ModalFooter
                    currentStep={currentStep}
                    isStepValid={isStepValid}
                    isLoading={isLoading}
                    canSave={canSave}
                    isPast={isPast}
                    isStarted={isStarted}
                    isPublished={isPublished}
                    editMode={editMode}
                    onCancel={handleCancel}
                    onPrevStep={handlePrevStep}
                    onNextStep={handleNextStep}
                    onSubmit={form.handleSubmit(handleSubmit)}
                    onUnpublish={handleUnpublish}
                    canUnpublish={canUnpublish}
                />
            </DialogContent>

            <CancelConfirmDialog
                open={showCancelConfirm}
                onOpenChange={setShowCancelConfirm}
                onConfirm={onClose}
            />
        </Dialog>
    );
};

export default EnhancedAddShiftModal;
export * from './types';

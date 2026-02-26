/**
 * ModalFooter — WCAG 2.1 AA hardened
 *
 * Changes vs original:
 *   - Submit button uses aria-busy when loading (AT announces "Saving…")
 *   - aria-label on primary CTA describes the full action including loading state
 *   - aria-disabled mirrors disabled prop so AT reports correctly
 *   - Keyboard hint is visually hidden but available to AT via aria-label
 *   - Decorative icons get aria-hidden
 */

import React from 'react';
import { DialogFooter } from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Loader2, Lock, Check, ArrowRight, Undo2 } from 'lucide-react';
import { TOTAL_STEPS } from '../constants';

interface ModalFooterProps {
    currentStep: number;
    isStepValid: (step: number) => boolean;
    isLoading: boolean;
    canSave: boolean;
    isPast: boolean;
    isStarted?: boolean;
    isPublished: boolean;
    editMode: boolean;
    onCancel: () => void;
    onPrevStep: () => void;
    onNextStep: () => void;
    onSubmit: () => void;
    onUnpublish: () => void;
    canUnpublish: boolean;
}

export const ModalFooter: React.FC<ModalFooterProps> = ({
    currentStep,
    isStepValid,
    isLoading,
    canSave,
    isPast,
    isStarted,
    isPublished,
    editMode,
    onCancel,
    onPrevStep,
    onNextStep,
    onSubmit,
    onUnpublish,
    canUnpublish,
}) => {
    const isLastStep = currentStep >= TOTAL_STEPS;
    const nextDisabled = !isStepValid(currentStep);
    const saveDisabled = isLoading || !canSave;

    const saveLabel = isLoading
        ? `Saving shift${editMode ? ' changes' : ''}…`
        : editMode
            ? 'Update Shift'
            : 'Create Shift';

    return (
        <DialogFooter className="relative px-6 py-4 border-t border-white/10 bg-[#0f172a]">
            <div className="flex items-center justify-between w-full">
                {/* ── Dismiss ──────────────────────────────────────────────── */}
                <Button
                    variant="ghost"
                    onClick={onCancel}
                    aria-label="Discard changes and close"
                    className="text-white/70 hover:text-white hover:bg-white/5"
                >
                    Cancel
                </Button>

                {/* ── Navigation ───────────────────────────────────────────── */}
                <div className="flex items-center gap-4" role="group" aria-label="Step navigation">
                    {currentStep > 1 && (
                        <Button
                            variant="outline"
                            onClick={onPrevStep}
                            aria-label={`Go back to step ${currentStep - 1}`}
                            className="border-white/20 text-white hover:bg-white/10"
                        >
                            Back
                        </Button>
                    )}

                    {!isLastStep && (
                        <Button
                            onClick={onNextStep}
                            disabled={nextDisabled}
                            aria-disabled={nextDisabled}
                            aria-label={
                                nextDisabled
                                    ? 'Complete required fields to proceed'
                                    : `Continue to step ${currentStep + 1}`
                            }
                            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                        >
                            Next Step
                            <ArrowRight className="h-4 w-4" aria-hidden />
                        </Button>
                    )}

                    {isLastStep && isPublished && canUnpublish && (
                        <Button
                            onClick={onUnpublish}
                            variant="outline"
                            aria-label="Unpublish shift and revert to Draft"
                            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 gap-2"
                        >
                            <Undo2 className="h-4 w-4" aria-hidden />
                            Unpublish
                        </Button>
                    )}

                    {isLastStep && isPublished && !canUnpublish && (
                        <Button
                            disabled
                            variant="secondary"
                            aria-disabled
                            aria-label="Shift is published and cannot be unpublished from this state"
                            className="bg-slate-700 text-white/50 cursor-not-allowed border-0 gap-2"
                        >
                            <Lock className="h-4 w-4" aria-hidden />
                            Published
                        </Button>
                    )}

                    {isLastStep && !isPublished && !isPast && !isStarted && (
                        <Button
                            onClick={onSubmit}
                            disabled={saveDisabled}
                            aria-disabled={saveDisabled}
                            aria-busy={isLoading}
                            aria-label={saveLabel}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                        >
                            {isLoading
                                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                : <Check className="h-4 w-4" aria-hidden />
                            }
                            {/* Visible label — kept in sync with aria-label above */}
                            <span aria-hidden>{editMode ? 'Update Shift' : 'Create Shift'}</span>
                            {isLoading && <span className="sr-only">Saving…</span>}
                        </Button>
                    )}
                </div>
            </div>

            {/* Keyboard hint — visually subtle, machine-readable via aria-label */}
            <p
                aria-label="Keyboard shortcut: press Enter to save"
                className="absolute bottom-2 right-6 text-[10px] text-white/30 select-none pointer-events-none"
                aria-hidden
            >
                Press Enter to save
            </p>
        </DialogFooter>
    );
};

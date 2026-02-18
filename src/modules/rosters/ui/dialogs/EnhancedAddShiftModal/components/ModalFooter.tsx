import React from 'react';
import { DialogFooter } from '@/modules/core/ui/primitives/dialog';
import { Button } from '@/modules/core/ui/primitives/button';
import { Loader2, Lock, Check, ArrowRight } from 'lucide-react';
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
    onUnpublish
}) => {
    return (
        <DialogFooter className="px-6 py-4 border-t border-white/10 bg-[#0f172a]">
            <div className="flex items-center justify-between w-full">
                <Button variant="ghost" onClick={onCancel} className="text-white/70 hover:text-white hover:bg-white/5">
                    Cancel
                </Button>

                <div className="flex items-center gap-4">
                    {/* Back Button */}
                    {currentStep > 1 && (
                        <Button
                            variant="outline"
                            onClick={onPrevStep}
                            className="border-white/20 text-white hover:bg-white/10"
                        >
                            Back
                        </Button>
                    )}

                    {/* Next / Submit Button */}
                    {currentStep < TOTAL_STEPS ? (
                        <Button
                            onClick={onNextStep}
                            disabled={!isStepValid(currentStep)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                        >
                            Next Step
                            <ArrowRight className="h-4 w-4" />
                        </Button>
                    ) : isPublished ? (
                        <Button
                            disabled
                            variant="secondary"
                            className="bg-slate-700 text-white/50 cursor-not-allowed border-0 gap-2"
                        >
                            <Lock className="h-4 w-4" />
                            Published (Locked)
                        </Button>
                    ) : (!isPast && !isStarted) && (
                        <Button
                            onClick={onSubmit}
                            disabled={isLoading || !canSave}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                        >
                            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            {editMode ? 'Update Shift' : 'Create Shift'}
                        </Button>
                    )}
                </div>
            </div>

            {/* Keyboard Hint */}
            <div className="absolute bottom-2 right-6 text-[10px] text-white/30">
                Press Enter to save
            </div>
        </DialogFooter>
    );
};

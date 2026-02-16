import React from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/modules/core/ui/primitives/alert-dialog";

interface CancelConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
}

export const CancelConfirmDialog: React.FC<CancelConfirmDialogProps> = ({
    open,
    onOpenChange,
    onConfirm
}) => {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="bg-[#1e293b] border-white/10 text-white">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-white">Discard changes?</AlertDialogTitle>
                    <AlertDialogDescription className="text-white/70">
                        You have unsaved changes. Are you sure you want to discard them and close the modal?
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel className="bg-transparent text-white/70 border-white/20 hover:bg-white/10 hover:text-white">Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm} className="bg-red-500 hover:bg-red-600 text-white border-0">Discard Changes</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

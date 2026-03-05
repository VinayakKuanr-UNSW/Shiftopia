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
            <AlertDialogContent className="bg-card border-border text-foreground">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-foreground">Discard changes?</AlertDialogTitle>
                    <AlertDialogDescription className="text-muted-foreground">
                        You have unsaved changes. Are you sure you want to discard them and close the modal?
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel className="bg-transparent text-muted-foreground border-white/20 hover:bg-white/10 hover:text-foreground">Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onConfirm} className="bg-red-500 hover:bg-red-600 text-foreground border-0">Discard Changes</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

import React from 'react';
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Loader2 } from "lucide-react";
import { AuditTrail } from "./AuditTrail";
import { useTimesheetAudit } from "../../../state/timesheet.hooks";
import { Button } from '@/modules/core/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/modules/core/ui/primitives/dialog';

interface AuditTrailModalProps {
    timesheetId: string | number;
    open: boolean;
    onOpenChange: (v: boolean) => void;
}

export const AuditTrailModal: React.FC<AuditTrailModalProps> = ({
    timesheetId,
    open,
    onOpenChange
}) => {
    const {
        data,
        loading,
        error,
        refresh
    } = useTimesheetAudit(timesheetId);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-sm p-0 border-0 shadow-none bg-transparent rounded-none [&>button]:hidden">
                <DialogTitle asChild>
                    <VisuallyHidden>Audit Trail for Timesheet {timesheetId}</VisuallyHidden>
                </DialogTitle>

                <DialogDescription asChild>
                    <VisuallyHidden>
                        View the complete history of changes and actions for this timesheet entry.
                    </VisuallyHidden>
                </DialogDescription>

                {loading ? (
                    <div className="bg-[#131516] text-slate-100 rounded-2xl p-8 flex flex-col items-center gap-4 w-80">
                        <Loader2 className="animate-spin" />
                        <p>Loading audit history…</p>
                    </div>
                ) : error ? (
                    <div className="bg-[#131516] text-slate-100 rounded-2xl p-8 w-80">
                        <p className="mb-4">Couldn't load audit history.</p>
                        <Button onClick={refresh} className="w-full">
                            Retry
                        </Button>
                    </div>
                ) : data && data.length === 0 ? (
                    <div className="bg-[#131516] text-slate-100 rounded-2xl p-8 w-80">
                        <p>No history for this entry.</p>
                    </div>
                ) : data && <AuditTrail events={data} onClose={() => onOpenChange(false)} />}
            </DialogContent>
        </Dialog>
    );
};

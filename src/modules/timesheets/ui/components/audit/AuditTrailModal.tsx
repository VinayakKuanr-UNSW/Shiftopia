import React from 'react';
import { Loader2 } from "lucide-react";
import { AuditTrail } from "./AuditTrail";
import { useTimesheetAudit } from "../../../state/timesheet.hooks";
import { Button } from '@/modules/core/ui/primitives/button';
import { ResponsiveDialog } from '@/modules/core/ui/components/ResponsiveDialog';

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
        <ResponsiveDialog open={open} onOpenChange={onOpenChange} dialogClassName="max-w-sm p-0 border-0 shadow-none bg-transparent rounded-none [&>button]:hidden">
            <ResponsiveDialog.Header className="sr-only">
                <ResponsiveDialog.Title>Audit Trail for Timesheet {timesheetId}</ResponsiveDialog.Title>
                <ResponsiveDialog.Description>
                    View the complete history of changes and actions for this timesheet entry.
                </ResponsiveDialog.Description>
            </ResponsiveDialog.Header>

            <ResponsiveDialog.Body>
                {loading ? (
                    <div className="bg-[#131516] text-slate-100 rounded-2xl p-8 flex flex-col items-center gap-4 w-80">
                        <Loader2 className="animate-spin" />
                        <p>Loading audit history…</p>
                    </div>
                ) : error ? (
                    <div className="bg-[#131516] text-slate-100 rounded-2xl p-8 w-80">
                        <p className="mb-4">Couldn't load audit history.</p>
                        <Button onClick={refresh} className="w-full min-h-[44px]">
                            Retry
                        </Button>
                    </div>
                ) : data && data.length === 0 ? (
                    <div className="bg-[#131516] text-slate-100 rounded-2xl p-8 w-80">
                        <p>No history for this entry.</p>
                    </div>
                ) : data && <AuditTrail events={data} onClose={() => onOpenChange(false)} />}
            </ResponsiveDialog.Body>
        </ResponsiveDialog>
    );
};

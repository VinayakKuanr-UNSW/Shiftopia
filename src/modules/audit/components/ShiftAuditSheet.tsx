import React from 'react';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from '@/modules/core/ui/primitives/sheet';
import { ScrollArea } from '@/modules/core/ui/primitives/scroll-area';
import { ClipboardList } from 'lucide-react';
import { ShiftTimeline } from './ShiftTimeline';

interface ShiftAuditSheetProps {
    shiftId: string | null;
    open: boolean;
    onClose: () => void;
}

/**
 * Slide-out panel that shows the full audit trail for a single shift.
 * Open from any shift ellipsis menu.
 */
export const ShiftAuditSheet: React.FC<ShiftAuditSheetProps> = ({ shiftId, open, onClose }) => {
    return (
        <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
            <SheetContent
                side="right"
                className="w-full sm:max-w-md bg-background border-border flex flex-col p-0"
            >
                <SheetHeader className="px-5 pt-5 pb-4 border-b border-border flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                            <ClipboardList className="w-4 h-4 text-blue-400" />
                        </div>
                        <div>
                            <SheetTitle className="text-foreground text-base">Audit Trail</SheetTitle>
                            <SheetDescription className="text-xs text-muted-foreground">
                                Complete history of every action on this shift
                            </SheetDescription>
                        </div>
                    </div>
                </SheetHeader>

                <ScrollArea className="flex-1">
                    <div className="px-5 py-4">
                        {shiftId ? (
                            <ShiftTimeline shiftId={shiftId} />
                        ) : (
                            <p className="text-sm text-muted-foreground">No shift selected.</p>
                        )}
                    </div>
                </ScrollArea>
            </SheetContent>
        </Sheet>
    );
};

import React from 'react';
import { DialogHeader, DialogTitle } from '@/modules/core/ui/primitives/dialog';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { Button } from '@/modules/core/ui/primitives/button';
import { CalendarDays, AlertCircle, Lock, CalendarIcon } from 'lucide-react';
import { format, parse } from 'date-fns';
import { ShiftContext } from '../types';

interface ModalHeaderProps {
    editMode: boolean;
    isReadOnly: boolean;
    isPast: boolean;
    isStarted?: boolean;
    isPublished: boolean;
    safeContext: ShiftContext;
    onUnpublish: () => void;
}

export const ModalHeader: React.FC<ModalHeaderProps> = ({
    editMode,
    isReadOnly,
    isPast,
    isStarted,
    isPublished,
    safeContext,
    onUnpublish
}) => {
    return (
        <>
            <DialogHeader className="px-6 py-4 border-b border-white/10 bg-[#0f172a]">
                <div className="flex items-center justify-between">
                    <DialogTitle className="flex items-center gap-2 text-white text-lg font-semibold">
                        <CalendarDays className="h-5 w-5 text-emerald-400" />
                        {editMode ? 'Edit Shift' : 'Add Shift'}
                        {isReadOnly && <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 ml-2">Read Only</Badge>}
                    </DialogTitle>

                    {/* Date and Context Summary */}
                    <div className="flex items-center gap-3 text-sm">
                        {safeContext.date && (
                            <div className="flex items-center gap-1.5 text-white/70">
                                <CalendarIcon className="h-4 w-4 text-emerald-400" />
                                {/* Display date safely without relying on browser time shifting */}
                                <span className="font-medium">{format(new Date(`${safeContext.date}T12:00:00`), 'EEE, dd MMM')}</span>
                            </div>
                        )}
                        {safeContext.groupName && safeContext.subGroupName && (
                            <div className="text-white/50">
                                {safeContext.groupName} · {safeContext.subGroupName}
                            </div>
                        )}
                    </div>
                </div>
            </DialogHeader>

            {isPast && (
                <div className="px-6 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-xs flex items-center gap-2 font-medium">
                    <AlertCircle className="h-4 w-4" />
                    This shift is in the past and is read-only.
                </div>
            )}

            {!isPast && isStarted && (
                <div className="px-6 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-xs flex items-center gap-2 font-medium">
                    <AlertCircle className="h-4 w-4" />
                    This shift has already started and is now read-only.
                </div>
            )}

            {isPublished && (
                <div className="px-6 py-2 bg-indigo-500/10 border-b border-indigo-500/20 text-indigo-400 text-xs flex items-center justify-between font-medium">
                    <div className="flex items-center gap-2">
                        <Lock className="h-4 w-4" />
                        This shift is published and locked. Backward transitions (unpublish) are not supported.
                    </div>
                    {/* Unpublish button removed for V3 Forward-Only Compliance */}
                </div>
            )}
        </>
    );
};

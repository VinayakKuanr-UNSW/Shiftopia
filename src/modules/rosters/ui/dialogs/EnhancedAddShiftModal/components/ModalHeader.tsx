/**
 * ModalHeader — WCAG 2.1 AA hardened
 *
 * Changes vs original:
 *   - Status banners use role="status" + aria-live="polite" so AT announces
 *     read-only / published / started conditions as they become true
 *   - Decorative icons get aria-hidden to avoid "alert circle" noise
 *   - CalendarDays icon is aria-hidden (text is adjacent)
 *   - Read-only badge adds sr-only context text
 *   - Group/sub-group context div has aria-label for AT
 */

import React from 'react';
import { DialogHeader, DialogTitle } from '@/modules/core/ui/primitives/dialog';
import { Badge } from '@/modules/core/ui/primitives/badge';
import { CalendarDays, AlertCircle, Lock, CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
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
}) => {
    return (
        <>
            <DialogHeader className="px-6 py-4 border-b border-white/10 bg-[#0f172a]">
                <div className="flex items-center justify-between">
                    <DialogTitle className="flex items-center gap-2 text-white text-lg font-semibold">
                        <CalendarDays className="h-5 w-5 text-emerald-400" aria-hidden />
                        {editMode ? 'Edit Shift' : 'Add Shift'}
                        {isReadOnly && (
                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 ml-2">
                                Read Only
                                <span className="sr-only"> — this shift cannot be edited</span>
                            </Badge>
                        )}
                    </DialogTitle>

                    {/* Date + context summary */}
                    <div
                        className="flex items-center gap-3 text-sm"
                        aria-label={[
                            safeContext.date && `Date: ${format(new Date(`${safeContext.date}T12:00:00`), 'EEEE, d MMMM')}`,
                            safeContext.groupName && safeContext.subGroupName && `Group: ${safeContext.groupName}, Sub-group: ${safeContext.subGroupName}`,
                        ].filter(Boolean).join('. ') || undefined}
                    >
                        {safeContext.date && (
                            <div className="flex items-center gap-1.5 text-white/70" aria-hidden>
                                <CalendarIcon className="h-4 w-4 text-emerald-400" aria-hidden />
                                <span className="font-medium">
                                    {format(new Date(`${safeContext.date}T12:00:00`), 'EEE, dd MMM')}
                                </span>
                            </div>
                        )}
                        {safeContext.groupName && safeContext.subGroupName && (
                            <div className="text-white/50" aria-hidden>
                                {safeContext.groupName} · {safeContext.subGroupName}
                            </div>
                        )}
                    </div>
                </div>
            </DialogHeader>

            {/* ── Status banners — aria-live so AT announces when they appear ── */}

            {isPast && (
                <div
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className="px-6 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-xs flex items-center gap-2 font-medium"
                >
                    <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden />
                    This shift is in the past and is read-only.
                </div>
            )}

            {!isPast && isStarted && (
                <div
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className="px-6 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 text-xs flex items-center gap-2 font-medium"
                >
                    <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden />
                    This shift has already started and is now read-only.
                </div>
            )}

            {isPublished && !isPast && !isStarted && (
                <div
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className="bg-indigo-500/10 border-b border-indigo-500/20 px-6 py-2.5 flex items-center justify-between"
                >
                    <div className="flex items-center gap-2 text-indigo-300 text-xs">
                        <Lock className="h-3.5 w-3.5" />
                        This shift is now published, locked and read-only.
                    </div>
                </div>
            )}
        </>
    );
};

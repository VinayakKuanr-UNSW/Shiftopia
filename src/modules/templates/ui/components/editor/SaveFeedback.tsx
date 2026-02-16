// src/modules/templates/ui/components/editor/SaveFeedback.tsx
// Visual feedback component for save operations

import React, { useEffect, useState } from 'react';
import { Check, Loader2, AlertCircle, Save } from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface SaveFeedbackProps {
    status: SaveStatus;
    message?: string;
    className?: string;
}

const statusConfig = {
    idle: {
        icon: Save,
        text: 'Ready to save',
        color: 'text-gray-400',
        bg: 'bg-gray-500/10',
        animate: false,
    },
    saving: {
        icon: Loader2,
        text: 'Saving...',
        color: 'text-blue-400',
        bg: 'bg-blue-500/10',
        animate: true,
    },
    saved: {
        icon: Check,
        text: 'Saved',
        color: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
        animate: false,
    },
    error: {
        icon: AlertCircle,
        text: 'Save failed',
        color: 'text-red-400',
        bg: 'bg-red-500/10',
        animate: false,
    },
};

export function SaveFeedback({ status, message, className }: SaveFeedbackProps) {
    const config = statusConfig[status];
    const Icon = config.icon;

    return (
        <div
            className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-300',
                config.bg,
                config.color,
                status === 'saved' && 'animate-in fade-in zoom-in-95 duration-200',
                className
            )}
        >
            <Icon
                className={cn(
                    'h-3.5 w-3.5',
                    config.animate && 'animate-spin'
                )}
            />
            <span>{message || config.text}</span>
        </div>
    );
}

/**
 * Auto-dismissing save feedback (shows "Saved" briefly then fades)
 */
export function AutoSaveFeedback({
    isSaving,
    lastSaved,
    hasChanges,
    className,
}: {
    isSaving: boolean;
    lastSaved: Date | null;
    hasChanges: boolean;
    className?: string;
}) {
    const [showSaved, setShowSaved] = useState(false);

    useEffect(() => {
        if (lastSaved && !isSaving) {
            setShowSaved(true);
            const timer = setTimeout(() => setShowSaved(false), 2000);
            return () => clearTimeout(timer);
        }
    }, [lastSaved, isSaving]);

    const status: SaveStatus = isSaving
        ? 'saving'
        : showSaved
            ? 'saved'
            : hasChanges
                ? 'idle'
                : 'idle';

    if (!isSaving && !showSaved && !hasChanges) {
        return null;
    }

    return <SaveFeedback status={status} className={className} />;
}

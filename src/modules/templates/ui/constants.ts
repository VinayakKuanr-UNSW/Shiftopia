// src/modules/templates/ui/constants.ts
// Shared constants for the Templates module UI

import { Building2, LayoutGrid, Theater, Film, Briefcase } from 'lucide-react';
import React from 'react';


/**
 * Visual configuration for each group type.
 * Used by TemplateEditor and related components.
 */
export const GROUP_CONFIG: Record<
    string,
    {
        icon: React.ReactNode;
        gradient: string;
        border: string;
        badge: string;
    }
> = {
    'Convention Centre': {
        icon: React.createElement(Building2, { className: 'h-5 w-5' }),
        gradient: 'from-blue-600/30 via-blue-500/10 to-transparent dark:from-blue-600/20 dark:via-blue-500/10',
        border: 'border-blue-500/30',
        badge: 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30',
    },
    'Exhibition Centre': {
        icon: React.createElement(LayoutGrid, { className: 'h-5 w-5' }),
        gradient: 'from-emerald-600/30 via-emerald-500/10 to-transparent dark:from-emerald-600/20 dark:via-emerald-500/10',
        border: 'border-emerald-500/30',
        badge: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    },
    Theatre: {
        icon: React.createElement(Theater, { className: 'h-5 w-5' }),
        gradient: 'from-red-600/30 via-red-500/10 to-transparent dark:from-red-600/20 dark:via-red-500/10',
        border: 'border-red-500/30',
        badge: 'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30',
    },
    'The Cutaway': {
        icon: React.createElement(Film, { className: 'h-5 w-5' }),
        gradient: 'from-amber-600/30 via-amber-500/10 to-transparent dark:from-amber-600/20 dark:via-amber-500/10',
        border: 'border-amber-500/30',
        badge: 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30',
    },
    Office: {
        icon: React.createElement(Briefcase, { className: 'h-5 w-5' }),
        gradient: 'from-cyan-600/30 via-cyan-500/10 to-transparent dark:from-cyan-600/20 dark:via-cyan-500/10',
        border: 'border-cyan-500/30',
        badge: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border-cyan-500/30',
    },
};



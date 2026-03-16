// src/modules/templates/ui/components/TemplateHeader.tsx
// Redesigned Template Editor Header - Premium Card UI

import React from 'react';
import { 
  ArrowLeft, 
  Save, 
  Trash2, 
  CheckCircle, 
  Loader2,
  Lock,
  RotateCw
} from 'lucide-react';
import { Button } from '@/modules/core/ui/primitives/button';
import { Badge } from '@/modules/core/ui/primitives/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/core/ui/primitives/tooltip';
import { cn } from '@/modules/core/lib/utils';
import { Template } from '../../model/templates.types';

/* ============================================================
   TYPES
   ============================================================ */
interface TemplateHeaderProps {
    template: Template;
    stats: {
        groupCount: number;
        subgroupCount: number;
        shiftCount: number;
    };
    hasUnsavedChanges: boolean;
    isSaving: boolean;
    lastSavedAgo: string;
    onBack: () => void;
    onSave: () => void;
    onDiscard: () => void;
    onArchive: () => void;
    onDownload?: () => void;
    onUpdateStatus: (status: 'draft' | 'published' | 'archived') => void;
}

/* ============================================================
   COMPONENT
   ============================================================ */
export const TemplateHeader: React.FC<TemplateHeaderProps> = ({
    template,
    stats,
    hasUnsavedChanges,
    isSaving,
    lastSavedAgo,
    onBack,
    onSave,
    onDiscard,
    onArchive,
    onDownload,
    onUpdateStatus,
}) => {
    const isPublished = template.status === 'published';
    const isDraft = template.status === 'draft';
    const isArchived = template.status === 'archived';

    return (
        <div className="w-full bg-[#f8f9fa] dark:bg-black/20 p-4 space-y-3">
            {/* 1. TOP NAVIGATION BAR */}
            <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onBack}
                        className="text-slate-500 hover:text-slate-900 dark:hover:text-white font-medium gap-1.5 h-8 px-2"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        <span className="text-sm">Back</span>
                    </Button>

                    <div className="h-4 w-[1px] bg-slate-200 dark:bg-slate-800" />

                    <span className="text-slate-800 dark:text-slate-200 text-sm font-bold tracking-tight">
                        Template Editor
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-bold text-slate-400 border-slate-200 dark:border-slate-800 tracking-widest px-2 py-0.5 uppercase bg-white dark:bg-slate-900/50">
                        ENVIRONMENT: PRODUCTION
                    </Badge>
                </div>
            </div>

            {/* 2. MAIN HEADER CARD */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 flex items-center justify-between">
                {/* Left Side: Info */}
                <div className="space-y-1.5 text-left">
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase">
                            {template.name}
                        </h1>
                        {hasUnsavedChanges && (
                            <div className="flex items-center gap-1 text-[10px] font-black text-amber-500 uppercase tracking-widest bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                                <div className="h-1 w-1 rounded-full bg-amber-500 animate-pulse" />
                                Unsaved
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        <span className={cn(
                            "px-1.5 py-0.5 rounded-sm",
                            isPublished && "text-emerald-500 bg-emerald-500/5",
                            isDraft && "text-blue-500 bg-blue-500/5",
                            isArchived && "text-purple-500 bg-purple-500/5"
                        )}>
                            {template.status === 'published' ? 'READY' : template.status}
                        </span>
                        
                        <span className="opacity-30">•</span>
                        
                        <span>V{template.version}</span>
                        
                        <div className="h-3 w-[1px] bg-slate-200 dark:bg-slate-800 mx-1" />
                        
                        <div className="flex items-center gap-1.5 lowercase normal-case">
                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                            <span className="capitalize text-slate-500 font-medium">Saved {lastSavedAgo} ago</span>
                        </div>

                        <span className="opacity-30">•</span>
                        
                        <span className="text-slate-500 font-medium normal-case">{stats.groupCount} Groups</span>
                        
                        <span className="opacity-30">•</span>
                        
                        <span className="text-slate-500 font-medium normal-case">{stats.subgroupCount} Subgroups</span>
                        
                        <span className="opacity-30">•</span>
                        
                        <span className="text-slate-500 font-medium normal-case">{stats.shiftCount} Shifts</span>
                    </div>
                </div>

                {/* Right Side: Actions */}
                <div className="flex items-center gap-4">
                    {/* Icon Action Group */}
                    <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-800/50 p-1.5 rounded-xl border border-slate-100 dark:border-slate-800">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={onSave}
                                        disabled={!hasUnsavedChanges || isSaving}
                                        className={cn(
                                            "h-8 w-8 rounded-lg transition-all",
                                            hasUnsavedChanges 
                                                ? "text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10" 
                                                : "text-slate-400 cursor-not-allowed"
                                        )}
                                    >
                                        {isSaving ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Save className="h-4 w-4" />
                                        )}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Save Template</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>

                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={onArchive}
                                        className="h-8 w-8 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition-all"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Archive Template</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>

                    {/* Primary Action */}
                    {isDraft ? (
                        <Button
                            onClick={() => onUpdateStatus('published')}
                            disabled={isSaving || hasUnsavedChanges}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-11 px-6 rounded-xl shadow-lg shadow-emerald-500/20 transition-all active:scale-95 gap-2"
                        >
                            {isSaving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <CheckCircle className="h-4 w-4" />
                            )}
                            Ready
                        </Button>
                    ) : isPublished ? (
                        <Button
                            onClick={() => onUpdateStatus('draft')}
                            disabled={isSaving}
                            className="bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white font-bold h-11 px-6 rounded-xl shadow-lg shadow-slate-500/10 transition-all active:scale-95 gap-2"
                        >
                            <Lock className="h-4 w-4" />
                            Unlock
                        </Button>
                    ) : (
                        <Button
                            onClick={() => onUpdateStatus('draft')}
                            disabled={isSaving}
                            className="bg-purple-600 hover:bg-purple-700 text-white font-bold h-11 px-6 rounded-xl shadow-lg shadow-purple-500/20 transition-all active:scale-95 gap-2"
                        >
                            <RotateCw className="h-4 w-4" />
                            Restore
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TemplateHeader;

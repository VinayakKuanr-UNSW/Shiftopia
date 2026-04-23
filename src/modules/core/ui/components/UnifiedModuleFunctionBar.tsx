import React from 'react';
import { Button } from '@/modules/core/ui/primitives/button';
import { RefreshCcw, LayoutGrid, List } from 'lucide-react';
import { CustomDateRangePicker } from './CustomDateRangePicker';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';

interface UnifiedModuleFunctionBarProps {
    startDate: Date;
    endDate: Date;
    onDateChange: (start: Date, end: Date) => void;
    viewMode: 'card' | 'table';
    onViewModeChange: (mode: 'card' | 'table') => void;
    onRefresh: () => void;
    isLoading?: boolean;
    filters?: React.ReactNode;
    leftContent?: React.ReactNode;
    className?: string;
    transparent?: boolean;
}

export const UnifiedModuleFunctionBar: React.FC<UnifiedModuleFunctionBarProps> = ({
    startDate,
    endDate,
    onDateChange,
    viewMode,
    onViewModeChange,
    onRefresh,
    isLoading = false,
    filters,
    leftContent,
    className,
    transparent = false
}) => {
    const { isDark } = useTheme();

    return (
        <div className={cn(
            "flex flex-row items-center gap-2 w-full transition-all p-1.5 rounded-2xl overflow-hidden",
            !transparent && (
                isDark 
                    ? "bg-[#1c2333]/40 backdrop-blur-md border border-white/5 shadow-2xl shadow-black/20" 
                    : "bg-white/60 backdrop-blur-md border border-white/80 shadow-lg shadow-slate-200/50"
            ),
            className
        )}>
            {/* 1. Left Content (Title or Tabs) - Visible on Desktop, Hidden on small mobile to save space if needed, 
                but user wants it in Row 3 if it's there. Let's keep it but very compact. */}
            {leftContent && (
                <div className="hidden lg:flex items-center px-1 flex-shrink-0">
                    {leftContent}
                </div>
            )}

            {/* Scrollable Container for all tools */}
            <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto scrollbar-none py-0.5">
                {/* 2. Date Range Picker (Start, End, Today) */}
                <div className="flex-shrink-0">
                    <CustomDateRangePicker
                        startDate={startDate}
                        endDate={endDate}
                        onDateChange={onDateChange}
                    />
                </div>

                {filters && (
                    <>
                        <div className="h-6 w-px bg-border/20 flex-shrink-0" />
                        {/* 3. Custom Filters (Priority toggles etc) */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                            {filters}
                        </div>
                    </>
                )}

                <div className="h-6 w-px bg-border/20 flex-shrink-0" />

                {/* 4. View Toggle (Card/Table) */}
                <div className={cn(
                    "flex items-center gap-1 p-1 rounded-xl flex-shrink-0",
                    isDark ? "bg-[#111827]/60" : "bg-slate-100"
                )}>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onViewModeChange('table')}
                        className={cn(
                            "h-8 w-8 lg:h-9 lg:w-9 rounded-lg transition-all",
                            viewMode === 'table' ? (isDark ? "bg-[#0f172a] text-white shadow-sm" : "bg-white text-slate-900 shadow-sm") : "text-muted-foreground hover:bg-muted/50"
                        )}
                    >
                        <List className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onViewModeChange('card')}
                        className={cn(
                            "h-8 w-8 lg:h-9 lg:w-9 rounded-lg transition-all",
                            viewMode === 'card' ? (isDark ? "bg-[#0f172a] text-white shadow-sm" : "bg-white text-slate-900 shadow-sm") : "text-muted-foreground hover:bg-muted/50"
                        )}
                    >
                        <LayoutGrid className="h-4 w-4" />
                    </Button>
                </div>

                {/* 5. Refresh Button */}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onRefresh}
                    disabled={isLoading}
                    className={cn(
                        "h-10 w-10 lg:h-11 lg:w-11 rounded-xl flex-shrink-0 transition-all",
                        isDark 
                            ? "bg-[#111827]/60 text-muted-foreground hover:text-white" 
                            : "bg-slate-200/50 text-slate-500 hover:text-slate-900 hover:bg-slate-200"
                    )}
                >
                    <RefreshCcw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                </Button>
            </div>
        </div>
    );
};

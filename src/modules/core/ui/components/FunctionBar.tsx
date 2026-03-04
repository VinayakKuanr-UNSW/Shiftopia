import React from 'react';
import { cn } from '@/modules/core/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { LayoutGrid, List, RefreshCw } from 'lucide-react';

export interface FunctionBarTab {
    id: string;
    label: string;
    count?: number;
    subContent?: React.ReactNode;
}

interface FunctionBarProps {
    tabs: FunctionBarTab[];
    activeTab: string;
    onTabChange: (tabId: string) => void;
    viewMode: 'card' | 'table';
    onViewModeChange: (mode: 'card' | 'table') => void;
    onRefresh?: () => void;
    className?: string;
    startActions?: React.ReactNode;
    endActions?: React.ReactNode;
}

export const FunctionBar: React.FC<FunctionBarProps> = ({
    tabs,
    activeTab,
    onTabChange,
    viewMode,
    onViewModeChange,
    onRefresh,
    className,
    startActions,
    endActions
}) => {
    return (
        <div className={cn(
            "flex flex-wrap items-center justify-between gap-4 p-2 rounded-xl",
            "bg-slate-100/60 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] backdrop-blur-sm",
            className
        )}>
            {/* Left: Tabs */}
            <div className="flex items-center gap-1 bg-white dark:bg-black/20 p-1 rounded-lg border border-slate-200 dark:border-white/5 shadow-sm dark:shadow-none">
                {tabs.map((tab) => {
                    const isActive = activeTab === tab.id;
                    return (
                        <div key={tab.id} className="flex items-center">
                            <button
                                onClick={() => onTabChange(tab.id)}
                                className={cn(
                                    "relative px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-300",
                                    "focus:outline-none focus:ring-1 focus:ring-primary/30 dark:focus:ring-white/10",
                                    isActive
                                        ? "text-primary dark:text-white"
                                        : "text-slate-500 dark:text-white/60 hover:text-slate-700 dark:hover:text-white/80"
                                )}
                            >
                                {isActive && (
                                    <motion.div
                                        layoutId="func-bar-tab-bg"
                                        className="absolute inset-0 bg-primary/8 dark:bg-white/10 rounded-md shadow-sm border border-primary/15 dark:border-white/5"
                                        transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                                    />
                                )}
                                <span className="relative z-10 flex items-center gap-2">
                                    {tab.label}
                                    {tab.count !== undefined && (
                                        <span className={cn(
                                            "text-[10px] px-1.5 py-0.5 rounded-full font-bold",
                                            isActive
                                                ? "bg-primary/15 dark:bg-white/20 text-primary dark:text-white"
                                                : "bg-slate-200 dark:bg-white/5 text-slate-500 dark:text-white/40"
                                        )}>
                                            {tab.count}
                                        </span>
                                    )}
                                </span>
                            </button>

                            <AnimatePresence>
                                {isActive && tab.subContent && (
                                    <motion.div
                                        initial={{ width: 0, opacity: 0, marginLeft: 0 }}
                                        animate={{ width: "auto", opacity: 1, marginLeft: 8 }}
                                        exit={{ width: 0, opacity: 0, marginLeft: 0 }}
                                        transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                                        className="overflow-hidden whitespace-nowrap"
                                    >
                                        {tab.subContent}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    );
                })}
            </div>

            {/* Middle/Start Actions (Optional) */}
            {startActions && (
                <div className="flex items-center gap-2">
                    {startActions}
                </div>
            )}

            {/* Right: View Toggles & End Actions */}
            <div className="flex items-center gap-3 ml-auto">
                {endActions}

                <div className="h-6 w-px bg-slate-200 dark:bg-white/10 mx-1" />

                <div className="flex items-center bg-white dark:bg-black/20 p-1 rounded-lg border border-slate-200 dark:border-white/5 shadow-sm dark:shadow-none">
                    <button
                        onClick={() => onViewModeChange('card')}
                        className={cn(
                            "p-1.5 rounded-md transition-all duration-200",
                            viewMode === 'card'
                                ? "bg-primary/10 dark:bg-white/10 text-primary dark:text-white shadow-sm"
                                : "text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white/70 hover:bg-slate-100 dark:hover:bg-white/5"
                        )}
                        title="Card View"
                    >
                        <LayoutGrid size={16} />
                    </button>
                    <button
                        onClick={() => onViewModeChange('table')}
                        className={cn(
                            "p-1.5 rounded-md transition-all duration-200",
                            viewMode === 'table'
                                ? "bg-primary/10 dark:bg-white/10 text-primary dark:text-white shadow-sm"
                                : "text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white/70 hover:bg-slate-100 dark:hover:bg-white/5"
                        )}
                        title="Table View"
                    >
                        <List size={16} />
                    </button>
                </div>

                {onRefresh && (
                    <button
                        onClick={onRefresh}
                        className="p-2 text-slate-400 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/80 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors border border-transparent hover:border-slate-200 dark:hover:border-white/10"
                        title="Refresh"
                    >
                        <RefreshCw size={16} />
                    </button>
                )}
            </div>
        </div>
    );
};

import React from 'react';
import { RefreshCcw, LayoutGrid, List, Search, Calendar, Settings, Layers, Filter, X } from 'lucide-react';
import { DateRangePicker } from '@/modules/core/ui/calendar';
import { cn } from '@/modules/core/lib/utils';
import { useTheme } from '@/modules/core/contexts/ThemeContext';
import { addDays, endOfMonth, format, startOfMonth } from 'date-fns';
import { startOfWeekAU, endOfWeekAU } from '@/modules/core/lib/date/week';
import { useBreakpoint } from '@/modules/core/hooks/useBreakpoint';
import {
    ToolbarRow,
    ToolbarSegmented,
    ToolbarIconButton,
    toolbar,
    type ToolbarSegmentedOption,
} from '@/modules/core/ui/components/Toolbar';

interface UnifiedModuleFunctionBarProps {
    startDate?: Date;
    endDate?: Date;
    onDateChange?: (start: Date, end: Date) => void;
    viewMode?: 'card' | 'table';
    onViewModeChange?: (mode: 'card' | 'table') => void;
    hideViewModeToggle?: boolean;
    onRefresh?: () => void;
    isLoading?: boolean;
    filters?: React.ReactNode;
    leftContent?: React.ReactNode;
    className?: string;
    transparent?: boolean;
    searchQuery?: string;
    onSearchChange?: (val: string) => void;
    children?: React.ReactNode;
}

const MODULE_VIEWS: ReadonlyArray<ToolbarSegmentedOption<'card' | 'table'>> = [
    { id: 'table', icon: <List className="h-3.5 w-3.5" />, label: 'List' },
    { id: 'card', icon: <LayoutGrid className="h-3.5 w-3.5" />, label: 'Card' },
];

const unwrapChildren = (children: React.ReactNode): React.ReactNode[] => {
    if (!children) return [];
    if (React.isValidElement(children) && children.type === React.Fragment) {
        return React.Children.toArray(children.props.children);
    }
    return React.Children.toArray(children);
};

/* ────────────────────────────────────────────────────────────────────────────
   MobileIconButton – 44×44 touch target (WCAG / ARIA compliant), 20×20 icon
   ──────────────────────────────────────────────────────────────────────────── */
export const MobileIconButton = React.forwardRef<
    HTMLButtonElement,
    {
        icon: React.ReactNode;
        label: string;
        onClick?: () => void;
        isActive?: boolean;
        disabled?: boolean;
        isDark: boolean;
        className?: string;
    }
>(({ icon, label, onClick, isActive, disabled, isDark, className, ...props }, ref) => (
    <button
        ref={ref}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={cn(
            "h-11 w-full flex items-center justify-center rounded-xl transition-all active:scale-95",
            isActive
                ? isDark
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                    : "bg-primary/10 text-primary ring-1 ring-primary/20"
                : isDark
                    ? "bg-white/5 text-white/70 active:bg-white/10"
                    : "bg-slate-100 text-slate-600 active:bg-slate-200",
            disabled && "opacity-40 pointer-events-none",
            className
        )}
        {...props}
    >
        {icon}
    </button>
));
MobileIconButton.displayName = 'MobileIconButton';

/**
 * Range shortcuts, defined once.
 *
 * The mobile and desktop pickers each carried their own list, and they had
 * already diverged — mobile offered Today / This Week / This Month, desktop
 * added Next week. `getRange` is resolved on click, so "this week" is always
 * the current one rather than whenever the module was loaded.
 */
const DATE_RANGE_PRESETS = [
    { label: 'Today', getRange: () => { const t = new Date(); return { from: t, to: t }; } },
    { label: 'This week', getRange: () => ({ from: startOfWeekAU(new Date()), to: endOfWeekAU(new Date()) }) },
    { label: 'Next week', getRange: () => ({ from: addDays(startOfWeekAU(new Date()), 7), to: addDays(endOfWeekAU(new Date()), 7) }) },
    { label: 'This month', getRange: () => { const n = new Date(); return { from: startOfMonth(n), to: endOfMonth(n) }; } },
];

export const UnifiedModuleFunctionBar: React.FC<UnifiedModuleFunctionBarProps> = ({
    startDate,
    endDate,
    onDateChange,
    viewMode,
    onViewModeChange,
    hideViewModeToggle = false,
    onRefresh,
    isLoading = false,
    filters,
    leftContent,
    className,
    transparent = false,
    searchQuery,
    onSearchChange,
    children
}) => {
    const { isDark } = useTheme();
    const breakpoint = useBreakpoint();
    const isMobile = breakpoint === 'mobile';
    const [showSearch, setShowSearch] = React.useState(!!searchQuery);

    if (isMobile) {
        const datePickerActive = !!(startDate && endDate && onDateChange);
        const refreshActive = !!onRefresh;
        const searchActive = onSearchChange !== undefined;
        const unwrappedFilters = unwrapChildren(filters);

        return (
            <div className={cn("flex flex-col gap-2 w-full", className)}>
                {/* Primary Function Icon Bar */}
                <div className="flex items-center gap-1.5 w-full overflow-x-auto scrollbar-none py-0.5">
                    {/* Left Content (e.g. Date navigator) */}
                    {leftContent && (
                        <div className="flex-1 min-w-0 flex items-center">
                            {leftContent}
                        </div>
                    )}

                    {datePickerActive && (
                        // The same `DateRangePicker` the desktop branch below
                        // uses, with the same presets. This used to be a second
                        // picker: a hand-rolled Drawer wrapping the raw
                        // `Calendar` with its own cell sizing and its own
                        // Today / This Week buttons — so the two paths could
                        // (and did) drift on what a range even meant. The
                        // shared picker already collapses to one month on a
                        // narrow viewport, which is what the drawer was for.
                        <DateRangePicker
                            label="Date range"
                            value={{ from: startDate, to: endDate }}
                            onChange={(range) => {
                                if (!range?.from) return;
                                onDateChange!(range.from, range.to ?? range.from);
                            }}
                            clearable={false}
                            displayFormat="d MMM"
                            presets={DATE_RANGE_PRESETS}
                            triggerClassName="h-11 rounded-xl font-semibold tabular-nums text-[11px]"
                        />
                    )}

                    {/* Search Icon Trigger */}
                    {searchActive && (
                        <MobileIconButton
                            icon={<Search className="h-4 w-4" />}
                            label="Search"
                            isActive={showSearch || !!searchQuery}
                            onClick={() => setShowSearch(!showSearch)}
                            isDark={isDark}
                            className="w-10 h-10 shrink-0"
                        />
                    )}

                    {/* Custom Filters */}
                    {unwrappedFilters.map((filter, idx) => (
                        <div key={`filter-${idx}`} className="shrink-0">
                            {filter}
                        </div>
                    ))}

                    {/* Refresh */}
                    {refreshActive && (
                        <MobileIconButton
                            icon={<RefreshCcw className={cn("h-4 w-4", isLoading && "animate-spin")} />}
                            label="Refresh data"
                            onClick={onRefresh}
                            disabled={isLoading}
                            isDark={isDark}
                            className="w-10 h-10 shrink-0"
                        />
                    )}
                </div>

                {/* Expandable Mobile Search Field */}
                {searchActive && (showSearch || !!searchQuery) && (
                    <div className={cn(
                        "flex items-center gap-2 px-3 h-[44px] rounded-xl border transition-all w-full",
                        isDark ? "bg-[#111827]/80 border-white/10" : "bg-slate-100 border-slate-200"
                    )}>
                        <Search className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                        <input
                            type="text"
                            value={searchQuery || ''}
                            onChange={(e) => onSearchChange!(e.target.value)}
                            placeholder="Search employee, role, or ID..."
                            aria-label="Search"
                            className="bg-transparent border-none text-[16px] font-medium placeholder:text-muted-foreground focus:ring-0 w-full outline-none"
                            autoFocus
                        />
                        {searchQuery && (
                            <button
                                onClick={() => onSearchChange!('')}
                                aria-label="Clear search"
                                className="flex h-[44px] w-[44px] shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                )}

                {/* Children / Tabs Row */}
                {children && (
                    // A row, like the icon bar above — as a plain block the
                    // page's controls each fell onto a line of their own.
                    <div className="flex w-full items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
                        {children}
                    </div>
                )}
            </div>
        );
    }

    // Desktop: the three zones every function bar shares (see Toolbar.tsx).
    const showViews = !hideViewModeToggle && !!onViewModeChange && !!viewMode;
    return (
        <ToolbarRow
            className={cn(!transparent && toolbar.standalone, className)}
            views={(showViews || leftContent) ? (
                <div className="flex items-center gap-3">
                    {showViews && (
                        <ToolbarSegmented
                            value={viewMode!}
                            onValueChange={onViewModeChange!}
                            options={MODULE_VIEWS}
                        />
                    )}
                    {/* A title or count, not a control — only where there is room for it. */}
                    {leftContent && <div className="hidden lg:flex items-center">{leftContent}</div>}
                </div>
            ) : undefined}
            modes={startDate && endDate && onDateChange ? (
                <DateRangePicker
                    label="Date range"
                    value={{ from: startDate, to: endDate }}
                    onChange={(range) => {
                        if (!range?.from) return;
                        onDateChange(range.from, range.to ?? range.from);
                    }}
                    clearable={false}
                    displayFormat="d MMM yy"
                    presets={DATE_RANGE_PRESETS}
                    triggerClassName={toolbar.field}
                />
            ) : undefined}
            actions={(filters || children || onSearchChange !== undefined || onRefresh) ? (<>
                {filters}
                {children}
                {onSearchChange !== undefined && (
                    <label className={toolbar.search}>
                        <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        <input
                            type="text"
                            aria-label="Search"
                            value={searchQuery || ''}
                            onChange={(e) => onSearchChange(e.target.value)}
                            placeholder="Search..."
                            className={toolbar.searchInput}
                        />
                    </label>
                )}
                {onRefresh && (
                    <ToolbarIconButton
                        icon={<RefreshCcw />}
                        tooltip="Reload"
                        onClick={onRefresh}
                        isLoading={isLoading}
                        variant="blue"
                    />
                )}
            </>) : undefined}
        />
    );
};

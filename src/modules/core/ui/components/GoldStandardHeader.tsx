import React from 'react';
import { LucideIcon } from 'lucide-react';
import { ScopeSelection } from '@/platform/auth/types';
import type { ScopeMode } from '@/platform/auth/scope-selection';
import { PersonalPageHeader } from './PersonalPageHeader';
import type { ScopeLevel } from './GlobalScopeFilter';
import { UnifiedModuleFunctionBar } from './UnifiedModuleFunctionBar';
import { surface } from '@/modules/core/ui/layout/pageTokens';
import { cn } from '@/modules/core/lib/utils';

/**
 * GoldStandardHeader
 *
 * THE single header used on every page. Renders as a self-contained glass
 * card disconnected on all four sides — equal padding to the sidebar, top,
 * right edge, and the body component below.
 *
 * Internal layout (3 rows, stacked inside the glass card):
 *   Row 1 — Page title (left) + live clock (right)
 *   Row 2 — Global scope filter (location / department / sub-department)
 *   Row 3 — Function bar (date range, filters, view toggle, search, actions)
 *
 * Usage modes:
 *   1. Pass a `functionBar` slot for fully custom Row-3 content (e.g. Roster
 *      DAY/3D/WEEK/MONTH switcher, Broadcasts category tabs).
 *   2. Pass the structured props (viewMode, startDate, filters, etc.) to use
 *      the built-in UnifiedModuleFunctionBar — convenient for planning pages.
 *
 * There is deliberately no slot beside the clock: every control goes in one of
 * the function bar's three zones (views · modes/date · actions), so a page
 * cannot park a picker or a link in a place no other page has one.
 *
 * Pages must NEVER render their own title / scope filter / function bar
 * outside this component. Render it as the first child of `PageLayout`, which
 * owns the gutter and the gap to the body card below it.
 */

// ─── Row 1 props ────────────────────────────────────────────────────────────
interface TitleRowProps {
    title: string;
    Icon: LucideIcon;
}

// ─── Row 2 props ────────────────────────────────────────────────────────────
interface ScopeRowProps {
    scope?: ScopeSelection;
    setScope?: (scope: ScopeSelection) => void;
    isGammaLocked?: boolean;
    mode?: ScopeMode;
    multiSelect?: boolean;
    /** Levels forced to a single choice — see `GlobalScopeFilterProps`. */
    singleSelectLevels?: ScopeLevel[];
}

// ─── Row 3 props (structured fallback to UnifiedModuleFunctionBar) ──────────
interface BuiltInFunctionBarProps {
    viewMode?: 'card' | 'table';
    onViewModeChange?: (mode: 'card' | 'table') => void;
    /**
     * Suppress the card/table switch while still using the built-in function
     * bar. For pages that own their own view switcher (e.g. Team Availability's
     * Team / Coverage / Declared / Near-miss tabs) and would otherwise show two
     * competing view controls.
     */
    hideViewModeToggle?: boolean;
    startDate?: Date;
    endDate?: Date;
    onDateChange?: (start: Date, end: Date) => void;
    onRefresh?: () => void;
    isLoading?: boolean;
    filters?: React.ReactNode;
    leftContent?: React.ReactNode;
    searchQuery?: string;
    onSearchChange?: (val: string) => void;
    /** Passed as children to UnifiedModuleFunctionBar (e.g. status tabs) */
    functionBarChildren?: React.ReactNode;
}

interface GoldStandardHeaderProps
    extends TitleRowProps,
        ScopeRowProps,
        BuiltInFunctionBarProps {
    /**
     * Fully custom Row-3 content. When provided, the structured function-bar
     * props are ignored and this slot is rendered as the function bar.
     * Use for pages with non-standard controls (e.g. Roster, Broadcasts).
     */
    functionBar?: React.ReactNode;
    subFunctionBar?: React.ReactNode;
    className?: string;
}

export const GoldStandardHeader: React.FC<GoldStandardHeaderProps> = ({
    // Row 1
    title,
    Icon,
    // Row 2
    scope,
    setScope,
    isGammaLocked,
    mode = 'personal',
    multiSelect,
    singleSelectLevels,
    // Row 3 (custom slot)
    functionBar,
    subFunctionBar,
    // Row 3 (structured)
    viewMode,
    onViewModeChange,
    hideViewModeToggle,
    startDate,
    endDate,
    onDateChange,
    onRefresh,
    isLoading,
    filters,
    leftContent,
    searchQuery,
    onSearchChange,
    functionBarChildren,
    className,
}) => {
    const usingBuiltIn = functionBar === undefined && viewMode !== undefined && onViewModeChange !== undefined;
    const showFunctionBar = functionBar !== undefined || usingBuiltIn;

    return (
        // No outer padding: PageLayout owns the gutter and the gap to the body.
        <div className={cn("flex-shrink-0", className)}>
            <div className={surface.headerCard}>
                {/* Subtle highlight effect for glassmorphism */}
                <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-white/5 to-transparent" />

                {/* ── Rows 1 & 2: Title · Clock · Scope Filter ── */}
                <PersonalPageHeader
                    title={title}
                    Icon={Icon}
                    scope={scope}
                    setScope={setScope}
                    isGammaLocked={isGammaLocked}
                    mode={mode}
                    multiSelect={multiSelect}
                    singleSelectLevels={singleSelectLevels}
                />

                {/* ── Row 3: Function Bar ── */}
                {showFunctionBar && (
                    functionBar !== undefined ? (
                        functionBar
                    ) : (
                        <UnifiedModuleFunctionBar
                            viewMode={viewMode!}
                            onViewModeChange={onViewModeChange!}
                            hideViewModeToggle={hideViewModeToggle}
                            startDate={startDate}
                            endDate={endDate}
                            onDateChange={onDateChange}
                            onRefresh={onRefresh}
                            isLoading={isLoading}
                            filters={filters}
                            leftContent={leftContent}
                            searchQuery={searchQuery}
                            onSearchChange={onSearchChange}
                            transparent
                        >
                            {functionBarChildren}
                        </UnifiedModuleFunctionBar>
                    )
                )}

                {/* ── Row 4: Sub-Function Bar (e.g. Bulk Selection Toolbar) ── */}
                {subFunctionBar && (
                    <div className="mt-1 pt-1 border-t border-border/10 md:mt-3 md:pt-3">
                        {subFunctionBar}
                    </div>
                )}
            </div>
        </div>
    );
};

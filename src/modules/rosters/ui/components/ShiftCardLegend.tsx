/**
 * ShiftCardLegend - Phase 4 Enterprise Component
 *
 * Visual legend explaining all icons used in SmartShiftCard / ShiftCardCompact.
 * Covers: Lifecycle, Assignment, Bidding, Offer Outcome, Trade, Compliance states.
 *
 * Render this in a popover, sidebar, or collapsible panel so users
 * can reference it without leaving the roster grid.
 */

import React, { useState } from 'react';
import {
    Edit,
    Megaphone,
    Hourglass,
    CheckCircle,
    XCircle,
    UserCheck,
    UserPlus,
    Clock,
    MailOpen,
    BadgeCheck,
    Zap,
    Gavel,
    Flame,
    Ban,
    Lock,
    ArrowLeftRight,
    Minus,
    ShieldCheck,
    Shield,
    ShieldAlert,
    ChevronDown,
    ChevronUp,
    HelpCircle,
    CopyPlus,
    Circle,
} from 'lucide-react';
import { cn } from '@/modules/core/lib/utils';

// ============================================================================
// TYPES
// ============================================================================

interface LegendItem {
    icon: React.ReactNode;
    label: string;
    description: string;
}

interface LegendSection {
    title: string;
    items: LegendItem[];
}

// ============================================================================
// LEGEND DATA
// ============================================================================

const LEGEND_SECTIONS: LegendSection[] = [
    {
        title: 'Lifecycle',
        items: [
            { icon: <Edit className="h-4 w-4 text-gray-400" />, label: 'Draft', description: 'Shift created but not yet published (S1-Unassigned, S2-Assigned)' },
            { icon: <Megaphone className="h-4 w-4 text-blue-500" />, label: 'Published', description: 'Shift is live and visible to employees' },
            { icon: <Hourglass className="h-4 w-4 text-orange-500" />, label: 'In Progress', description: 'Shift is currently being worked (S11-Confirmed, S12-Emergency)' },
            { icon: <CheckCircle className="h-4 w-4 text-green-500" />, label: 'Completed', description: 'Shift has been completed (S13-Confirmed, S14-Emergency)' },
            { icon: <XCircle className="h-4 w-4 text-red-500" />, label: 'Cancelled', description: 'Shift has been cancelled (S15)' },
        ],
    },
    {
        title: 'Assignment',
        items: [
            { icon: <UserCheck className="h-4 w-4 text-emerald-500" />, label: 'Assigned', description: 'An employee is assigned to this shift' },
            { icon: <UserPlus className="h-4 w-4 text-amber-500" />, label: 'Unassigned', description: 'No employee assigned yet' },
        ],
    },
    {
        title: 'Offer Outcome',
        items: [
            { icon: <Clock className="h-4 w-4 text-yellow-500" />, label: 'Pending', description: 'Assignment pending employee response (S2 Implicit)' },
            { icon: <MailOpen className="h-4 w-4 text-blue-500" />, label: 'Offered', description: 'Offer sent, awaiting acceptance (S3)' },
            { icon: <BadgeCheck className="h-4 w-4 text-green-600" />, label: 'Confirmed', description: 'Employee accepted the offer (S4)' },
            { icon: <Zap className="h-4 w-4 text-red-500" />, label: 'Emergency Assigned', description: 'Emergency assignment (auto-confirmed) (S7)' },
        ],
    },
    {
        title: 'Bidding',
        items: [
            { icon: <Gavel className="h-4 w-4 text-blue-500" />, label: 'On Bidding (Normal)', description: 'Open for employee bids (S5)' },
            { icon: <Flame className="h-4 w-4 text-red-500" />, label: 'On Bidding (Urgent)', description: 'Urgent bidding - shift starts soon (S6)' },
            { icon: <Lock className="h-4 w-4 text-gray-600" />, label: 'Bidding Closed', description: 'Bidding window expired with no winner (S8)' },
            { icon: <Ban className="h-4 w-4 text-gray-400" />, label: 'Not On Bidding', description: 'Shift is not open for bidding' },
        ],
    },
    {
        title: 'Trade',
        items: [
            { icon: <ArrowLeftRight className="h-4 w-4 text-purple-500" />, label: 'Trade Requested', description: 'Employee requested a shift swap (S9)' },
            { icon: <Minus className="h-4 w-4 text-gray-400" />, label: 'No Trade', description: 'No trade request active' },
        ],
    },
    {
        title: 'Origin',
        items: [
            { icon: <CopyPlus className="h-4 w-4 text-indigo-400" />, label: 'Template', description: 'Generated from a Roster Template' },
            { icon: <Circle className="h-4 w-4 text-gray-500" />, label: 'Manual', description: 'Manually created by a manager' },
        ],
    },
    {
        title: 'Compliance',
        items: [
            { icon: <ShieldCheck className="h-4 w-4 text-emerald-500" />, label: 'Compliant', description: 'All compliance rules satisfied' },
            { icon: <Shield className="h-4 w-4 text-amber-500" />, label: 'Warning', description: 'Approaching compliance limits' },
            { icon: <ShieldAlert className="h-4 w-4 text-red-500" />, label: 'Violation', description: 'Compliance rule violated' },
        ],
    },
];

// ============================================================================
// PROPS
// ============================================================================

export interface ShiftCardLegendProps {
    className?: string;
    /** Start collapsed */
    defaultCollapsed?: boolean;
    /** Inline mode renders a compact single-row summary */
    inline?: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

export const ShiftCardLegend: React.FC<ShiftCardLegendProps> = ({
    className,
    defaultCollapsed = true,
    inline = false,
}) => {
    const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

    // Inline mode: flat row of all icons with tooltips
    if (inline) {
        return (
            <div className={cn('flex flex-wrap items-center gap-3 text-xs', className)}>
                <HelpCircle className="h-3.5 w-3.5 text-white/40 shrink-0" />
                {LEGEND_SECTIONS.map((section) =>
                    section.items.map((item) => (
                        <div
                            key={item.label}
                            className="flex items-center gap-1 text-white/60"
                            title={`${item.label}: ${item.description}`}
                        >
                            {item.icon}
                            <span className="text-[10px]">{item.label}</span>
                        </div>
                    ))
                )}
            </div>
        );
    }

    return (
        <div className={cn('rounded-xl border border-white/10 bg-black/20 backdrop-blur-sm overflow-hidden', className)}>
            {/* Toggle Header */}
            <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <HelpCircle className="h-3.5 w-3.5 text-white/50" />
                    <span className="text-xs font-medium text-white/80">Shift Card Legend</span>
                </div>
                {isCollapsed ? (
                    <ChevronDown className="h-3.5 w-3.5 text-white/40" />
                ) : (
                    <ChevronUp className="h-3.5 w-3.5 text-white/40" />
                )}
            </button>

            {/* Legend Body - Compact Grid */}
            {!isCollapsed && (
                <div className="px-3 pb-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                    {LEGEND_SECTIONS.map((section) => (
                        <div key={section.title} className="space-y-1.5">
                            <h4 className="text-[9px] font-bold uppercase tracking-widest text-white/30 border-b border-white/5 pb-0.5">
                                {section.title}
                            </h4>
                            <div className="space-y-1">
                                {section.items.map((item) => (
                                    <div key={item.label} className="flex items-center gap-1.5 group select-none" title={item.description}>
                                        <div className="shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                                            {React.cloneElement(item.icon as React.ReactElement, { className: cn((item.icon as React.ReactElement).props.className, 'h-3 w-3') })}
                                        </div>
                                        <span className="text-[10px] text-white/60 group-hover:text-white/90 truncate cursor-help transition-colors">
                                            {item.label}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ShiftCardLegend;

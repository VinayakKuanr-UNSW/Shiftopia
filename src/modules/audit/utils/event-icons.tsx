// src/modules/audit/utils/event-icons.tsx
import {
    FilePlus,
    Send,
    Eye,
    EyeOff,
    Trash2,
    XCircle,
    Megaphone,
    HandMetal,
    CheckCircle2,
    Undo2,
    UserCheck,
    UserMinus,
    ArrowLeftRight,
    LogIn,
    LogOut,
    Edit3,
    UserX,
    Calendar,
    Clock,
    MapPin,
    AlertTriangle,
    Shield,
    Bot,
    User,
    Layers,
} from 'lucide-react';

export type EventCategory = 'creation' | 'status' | 'bidding' | 'assignment' | 'attendance' | 'modification' | 'trading' | 'schedule' | 'details';

export interface EventIconConfig {
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    bgColor: string;
    category: EventCategory;
    label: string;
}

/**
 * Maps event types to icons with color coding
 */
export const EVENT_ICONS: Record<string, EventIconConfig> = {
    // Creation & Status (Gray/Blue)
    shift_created_draft: {
        icon: FilePlus,
        color: 'text-gray-400',
        bgColor: 'bg-gray-500/20',
        category: 'creation',
        label: 'Draft Created',
    },
    shift_created_published: {
        icon: Send,
        color: 'text-blue-400',
        bgColor: 'bg-blue-500/20',
        category: 'creation',
        label: 'Published',
    },
    published: {
        icon: Eye,
        color: 'text-blue-400',
        bgColor: 'bg-blue-500/20',
        category: 'status',
        label: 'Published',
    },
    unpublished: {
        icon: EyeOff,
        color: 'text-gray-400',
        bgColor: 'bg-gray-500/20',
        category: 'status',
        label: 'Unpublished',
    },
    shift_soft_deleted: {
        icon: Trash2,
        color: 'text-red-400',
        bgColor: 'bg-red-500/20',
        category: 'status',
        label: 'Deleted',
    },
    shift_deleted: {
        icon: Trash2,
        color: 'text-red-400',
        bgColor: 'bg-red-500/20',
        category: 'status',
        label: 'Deleted',
    },
    cancelled: {
        icon: XCircle,
        color: 'text-red-400',
        bgColor: 'bg-red-500/20',
        category: 'status',
        label: 'Cancelled',
    },
    uncancelled: {
        icon: Undo2,
        color: 'text-green-400',
        bgColor: 'bg-green-500/20',
        category: 'status',
        label: 'Uncancelled',
    },
    draft_status_changed: {
        icon: Edit3,
        color: 'text-gray-400',
        bgColor: 'bg-gray-500/20',
        category: 'status',
        label: 'Draft Status Changed',
    },

    // Bidding (Purple)
    pushed_to_bidding: {
        icon: Megaphone,
        color: 'text-purple-400',
        bgColor: 'bg-purple-500/20',
        category: 'bidding',
        label: 'Opened for Bidding',
    },
    removed_from_bidding: {
        icon: Undo2,
        color: 'text-amber-400',
        bgColor: 'bg-amber-500/20',
        category: 'bidding',
        label: 'Removed from Bidding',
    },
    bid_placed: {
        icon: HandMetal,
        color: 'text-purple-400',
        bgColor: 'bg-purple-500/20',
        category: 'bidding',
        label: 'Bid Placed',
    },
    bid_submitted: {
        icon: HandMetal,
        color: 'text-purple-400',
        bgColor: 'bg-purple-500/20',
        category: 'bidding',
        label: 'Bid Submitted',
    },
    bid_won: {
        icon: CheckCircle2,
        color: 'text-green-400',
        bgColor: 'bg-green-500/20',
        category: 'bidding',
        label: 'Bid Won',
    },
    bid_accepted: {
        icon: CheckCircle2,
        color: 'text-green-400',
        bgColor: 'bg-green-500/20',
        category: 'bidding',
        label: 'Bid Accepted',
    },
    bid_rejected: {
        icon: XCircle,
        color: 'text-red-400',
        bgColor: 'bg-red-500/20',
        category: 'bidding',
        label: 'Bid Rejected',
    },
    bid_withdrawn: {
        icon: Undo2,
        color: 'text-amber-400',
        bgColor: 'bg-amber-500/20',
        category: 'bidding',
        label: 'Bid Withdrawn',
    },
    bid_status_changed: {
        icon: Edit3,
        color: 'text-purple-400',
        bgColor: 'bg-purple-500/20',
        category: 'bidding',
        label: 'Bid Updated',
    },

    // Trading (Violet)
    trade_requested: {
        icon: ArrowLeftRight,
        color: 'text-violet-400',
        bgColor: 'bg-violet-500/20',
        category: 'trading',
        label: 'Trade Requested',
    },
    trade_offer_submitted: {
        icon: HandMetal,
        color: 'text-violet-400',
        bgColor: 'bg-violet-500/20',
        category: 'trading',
        label: 'Offer Submitted',
    },
    trade_offer_selected: {
        icon: CheckCircle2,
        color: 'text-violet-400',
        bgColor: 'bg-violet-500/20',
        category: 'trading',
        label: 'Offer Selected',
    },
    trade_pending_manager: {
        icon: Clock,
        color: 'text-amber-400',
        bgColor: 'bg-amber-500/20',
        category: 'trading',
        label: 'Pending Manager',
    },
    trade_approved: {
        icon: CheckCircle2,
        color: 'text-green-400',
        bgColor: 'bg-green-500/20',
        category: 'trading',
        label: 'Trade Approved',
    },
    trade_rejected: {
        icon: XCircle,
        color: 'text-red-400',
        bgColor: 'bg-red-500/20',
        category: 'trading',
        label: 'Trade Rejected',
    },
    trade_cancelled: {
        icon: XCircle,
        color: 'text-gray-400',
        bgColor: 'bg-gray-500/20',
        category: 'trading',
        label: 'Trade Cancelled',
    },
    trade_expired: {
        icon: Clock,
        color: 'text-gray-400',
        bgColor: 'bg-gray-500/20',
        category: 'trading',
        label: 'Trade Expired',
    },
    trade_offer_rejected: {
        icon: XCircle,
        color: 'text-red-400',
        bgColor: 'bg-red-500/20',
        category: 'trading',
        label: 'Offer Rejected',
    },
    trade_offer_withdrawn: {
        icon: Undo2,
        color: 'text-amber-400',
        bgColor: 'bg-amber-500/20',
        category: 'trading',
        label: 'Offer Withdrawn',
    },
    trade_offer_expired: {
        icon: Clock,
        color: 'text-gray-400',
        bgColor: 'bg-gray-500/20',
        category: 'trading',
        label: 'Offer Expired',
    },

    // Assignment (Indigo)
    employee_assigned: {
        icon: UserCheck,
        color: 'text-indigo-400',
        bgColor: 'bg-indigo-500/20',
        category: 'assignment',
        label: 'Employee Assigned',
    },
    employee_unassigned: {
        icon: UserMinus,
        color: 'text-amber-400',
        bgColor: 'bg-amber-500/20',
        category: 'assignment',
        label: 'Employee Unassigned',
    },
    assignment_swapped: {
        icon: ArrowLeftRight,
        color: 'text-indigo-400',
        bgColor: 'bg-indigo-500/20',
        category: 'assignment',
        label: 'Assignment Swapped',
    },

    // Schedule (Teal)
    schedule_changed: {
        icon: Calendar,
        color: 'text-teal-400',
        bgColor: 'bg-teal-500/20',
        category: 'schedule',
        label: 'Schedule Changed',
    },
    notes_updated: {
        icon: Edit3,
        color: 'text-teal-400',
        bgColor: 'bg-teal-500/20',
        category: 'details',
        label: 'Notes Updated',
    },

    // Attendance (Green/Red)
    checked_in: {
        icon: LogIn,
        color: 'text-green-400',
        bgColor: 'bg-green-500/20',
        category: 'attendance',
        label: 'Checked In',
    },
    checked_out: {
        icon: LogOut,
        color: 'text-green-400',
        bgColor: 'bg-green-500/20',
        category: 'attendance',
        label: 'Checked Out',
    },
    manual_adjustment: {
        icon: Edit3,
        color: 'text-amber-400',
        bgColor: 'bg-amber-500/20',
        category: 'attendance',
        label: 'Manual Adjustment',
    },
    no_show_recorded: {
        icon: UserX,
        color: 'text-red-400',
        bgColor: 'bg-red-500/20',
        category: 'attendance',
        label: 'No Show',
    },

    // Modification (Amber)
    field_updated: {
        icon: Edit3,
        color: 'text-amber-400',
        bgColor: 'bg-amber-500/20',
        category: 'modification',
        label: 'Field Updated',
    },
    shift_updated: {
        icon: Edit3,
        color: 'text-amber-400',
        bgColor: 'bg-amber-500/20',
        category: 'modification',
        label: 'Shift Updated',
    },
};

/**
 * Get icon config for event type, with fallback
 */
export const getEventIcon = (eventType: string): EventIconConfig => {
    return (
        EVENT_ICONS[eventType] || {
            icon: Calendar,
            color: 'text-gray-400',
            bgColor: 'bg-gray-500/20',
            category: 'modification',
            label: eventType,
        }
    );
};

/**
 * Role-based icons for the "Who" badge
 */
export const ROLE_ICONS = {
    manager: Shield,
    admin: Shield,
    team_lead: Shield,
    employee: User,
    system_automation: Bot,
    system: Bot,
};

export const getRoleIcon = (role: string): React.ComponentType<{ className?: string }> => {
    const normalizedRole = role.toLowerCase().replace(/\s+/g, '_');
    return ROLE_ICONS[normalizedRole as keyof typeof ROLE_ICONS] || User;
};

/**
 * Batch indicator icon
 */
export const BatchIcon = Layers;

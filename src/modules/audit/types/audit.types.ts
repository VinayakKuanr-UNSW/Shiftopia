import { ShiftStateID } from '@/modules/rosters/domain/shiftStateMachine';

// ── Raw DB row ───────────────────────────────────────────────────────────────

export interface AuditLogEntry {
    id:          string;
    shift_id:    string;
    action:      AuditAction;
    from_state:  ShiftStateID | null;
    to_state:    ShiftStateID | null;
    actor_id:    string | null;
    actor_role:  string;
    target_id:   string | null;
    reason:      string | null;
    metadata:    Record<string, unknown>;
    occurred_at: string; // ISO timestamptz
}

// With joined actor profile (for display)
export interface AuditLogEntryWithActor extends AuditLogEntry {
    actor: {
        full_name:   string | null;
        avatar_url:  string | null;
        email:       string | null;
    } | null;
    target: {
        full_name:   string | null;
        avatar_url:  string | null;
    } | null;
}

// ── Action catalogue ─────────────────────────────────────────────────────────

export type AuditAction =
    // Shift lifecycle
    | 'CREATE'
    | 'ASSIGN'
    | 'UNASSIGN'
    | 'PUBLISH'
    | 'UNPUBLISH'
    | 'DELETE'
    | 'CANCEL'
    | 'FIELD_EDIT'
    // Offer
    | 'OFFER_ACCEPTED'
    | 'OFFER_DECLINED'
    | 'OFFER_EXPIRED'
    | 'OFFER_EXPIRED_TO_URGENT'
    | 'OFFER_EXPIRED_LOCKED'
    // Bidding
    | 'BID_PLACED'
    | 'BID_SELECTED'
    | 'BID_REJECTED'
    | 'BID_WITHDRAWN'
    | 'BIDDING_TIMEOUT'
    | 'BIDDING_LOCKED_AT_START'
    | 'EMERGENCY_ASSIGN'
    // Trade / Swap
    | 'TRADE_REQUESTED'
    | 'TRADE_OFFER_ACCEPTED'
    | 'TRADE_PEER_ACCEPTED'
    | 'TRADE_APPROVED'
    | 'TRADE_REJECTED'
    | 'TRADE_CANCELLED'
    | 'TRADE_EXPIRED'
    | 'TRADE_MANAGER_RESOLVED'
    // Attendance
    | 'SHIFT_STARTED'
    | 'SHIFT_COMPLETED'
    | 'CHECK_IN'
    | 'CHECK_OUT'
    | 'MARK_NO_SHOW';

// ── Display helpers ──────────────────────────────────────────────────────────

export interface AuditActionMeta {
    label:    string;
    icon:     string;   // Lucide icon name
    color:    string;   // Tailwind colour class for the icon bg
    category: AuditCategory;
}

export type AuditCategory =
    | 'lifecycle'
    | 'offer'
    | 'bidding'
    | 'trade'
    | 'attendance'
    | 'system';

export const AUDIT_ACTION_META: Record<AuditAction, AuditActionMeta> = {
    CREATE:                   { label: 'Shift created',             icon: 'Plus',          color: 'bg-blue-500/20 text-blue-400',    category: 'lifecycle'  },
    ASSIGN:                   { label: 'Employee assigned',         icon: 'UserPlus',      color: 'bg-violet-500/20 text-violet-400', category: 'lifecycle'  },
    UNASSIGN:                 { label: 'Employee unassigned',       icon: 'UserMinus',     color: 'bg-orange-500/20 text-orange-400', category: 'lifecycle'  },
    PUBLISH:                  { label: 'Shift published',           icon: 'Send',          color: 'bg-green-500/20 text-green-400',   category: 'lifecycle'  },
    UNPUBLISH:                { label: 'Shift unpublished',         icon: 'EyeOff',        color: 'bg-gray-500/20 text-gray-400',     category: 'lifecycle'  },
    DELETE:                   { label: 'Shift deleted',             icon: 'Trash2',        color: 'bg-red-500/20 text-red-400',       category: 'lifecycle'  },
    CANCEL:                   { label: 'Shift cancelled',           icon: 'XCircle',       color: 'bg-red-500/20 text-red-400',       category: 'lifecycle'  },
    FIELD_EDIT:               { label: 'Shift details edited',      icon: 'Pencil',        color: 'bg-sky-500/20 text-sky-400',       category: 'lifecycle'  },
    OFFER_ACCEPTED:           { label: 'Offer accepted',            icon: 'CheckCircle',   color: 'bg-green-500/20 text-green-400',   category: 'offer'      },
    OFFER_DECLINED:           { label: 'Offer declined',            icon: 'XCircle',       color: 'bg-red-500/20 text-red-400',       category: 'offer'      },
    OFFER_EXPIRED:            { label: 'Offer expired',             icon: 'Clock',         color: 'bg-yellow-500/20 text-yellow-400', category: 'offer'      },
    OFFER_EXPIRED_TO_URGENT:  { label: 'Offer expired → urgent',   icon: 'Clock',         color: 'bg-yellow-500/20 text-yellow-400', category: 'offer'      },
    OFFER_EXPIRED_LOCKED:     { label: 'Offer expired (locked)',    icon: 'Lock',          color: 'bg-red-500/20 text-red-400',       category: 'offer'      },
    BID_PLACED:               { label: 'Bid placed',                icon: 'Gavel',         color: 'bg-cyan-500/20 text-cyan-400',     category: 'bidding'    },
    BID_SELECTED:             { label: 'Bid winner selected',       icon: 'Trophy',        color: 'bg-green-500/20 text-green-400',   category: 'bidding'    },
    BID_REJECTED:             { label: 'Bid rejected',              icon: 'XCircle',       color: 'bg-red-500/20 text-red-400',       category: 'bidding'    },
    BID_WITHDRAWN:            { label: 'Bid withdrawn',             icon: 'Undo2',         color: 'bg-gray-500/20 text-gray-400',     category: 'bidding'    },
    BIDDING_TIMEOUT:          { label: 'Bidding closed (timeout)',  icon: 'TimerOff',      color: 'bg-orange-500/20 text-orange-400', category: 'bidding'    },
    BIDDING_LOCKED_AT_START:  { label: 'Bidding locked at start',   icon: 'Lock',          color: 'bg-red-500/20 text-red-400',       category: 'bidding'    },
    EMERGENCY_ASSIGN:         { label: 'Emergency assignment',      icon: 'Zap',           color: 'bg-red-500/20 text-red-400',       category: 'bidding'    },
    TRADE_REQUESTED:          { label: 'Trade requested',           icon: 'ArrowLeftRight',color: 'bg-violet-500/20 text-violet-400', category: 'trade'      },
    TRADE_OFFER_ACCEPTED:     { label: 'Trade offer selected',      icon: 'Handshake',     color: 'bg-indigo-500/20 text-indigo-400', category: 'trade'      },
    TRADE_PEER_ACCEPTED:      { label: 'Trade peer accepted',       icon: 'Handshake',     color: 'bg-indigo-500/20 text-indigo-400', category: 'trade'      },
    TRADE_APPROVED:           { label: 'Trade approved',            icon: 'CheckCircle',   color: 'bg-green-500/20 text-green-400',   category: 'trade'      },
    TRADE_REJECTED:           { label: 'Trade rejected',            icon: 'XCircle',       color: 'bg-red-500/20 text-red-400',       category: 'trade'      },
    TRADE_CANCELLED:          { label: 'Trade cancelled',           icon: 'X',             color: 'bg-gray-500/20 text-gray-400',     category: 'trade'      },
    TRADE_EXPIRED:            { label: 'Trade expired',             icon: 'Timer',         color: 'bg-yellow-500/20 text-yellow-400', category: 'trade'      },
    TRADE_MANAGER_RESOLVED:   { label: 'Trade resolved by manager', icon: 'ShieldCheck',   color: 'bg-blue-500/20 text-blue-400',     category: 'trade'      },
    SHIFT_STARTED:            { label: 'Shift started',             icon: 'PlayCircle',    color: 'bg-green-500/20 text-green-400',   category: 'attendance' },
    SHIFT_COMPLETED:          { label: 'Shift completed',           icon: 'CheckCircle2',  color: 'bg-green-500/20 text-green-400',   category: 'attendance' },
    CHECK_IN:                 { label: 'Employee clocked in',       icon: 'LogIn',         color: 'bg-cyan-500/20 text-cyan-400',     category: 'attendance' },
    CHECK_OUT:                { label: 'Employee clocked out',      icon: 'LogOut',        color: 'bg-cyan-500/20 text-cyan-400',     category: 'attendance' },
    MARK_NO_SHOW:             { label: 'Marked as no-show',         icon: 'UserX',         color: 'bg-red-500/20 text-red-400',       category: 'attendance' },
};

// ── Filters ──────────────────────────────────────────────────────────────────

export interface AuditFilters {
    shiftId?:   string;
    actorId?:   string;
    action?:    AuditAction;
    category?:  AuditCategory;
    fromDate?:  string;  // ISO date
    toDate?:    string;  // ISO date
    limit?:     number;
    orgIds?:    string[];
    deptIds?:   string[];
}

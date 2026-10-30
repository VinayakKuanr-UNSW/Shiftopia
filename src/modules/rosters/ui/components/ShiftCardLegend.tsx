import React from 'react';
import {
    Edit,
    Hourglass,
    CheckCircle,
    XCircle,
    Zap,
    Flame,
    Lock,
    ArrowLeftRight,
    ShieldAlert,
    CopyPlus,
    Clock,
    Gavel,
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface BadgeCodeItem {
    type: 'Planning' | 'Live' | 'Terminal' | 'System';
    dot?: string; // Hex color
    code?: string;
    icon: React.ReactNode;
    label: string;
    description: string;
}

// ============================================================================
// LEGEND DATA (Unified Source of Truth)
// ============================================================================

export const BADGE_CODES: BadgeCodeItem[] = [
    // PLANNING
    { type: 'Planning', dot: '#3B82F6', code: 'S1-S5', icon: <Edit className="h-3 w-3" />, label: 'Normal', description: '> 24h until shift start' },
    { type: 'Planning', dot: '#F59E0B', code: 'S3-S5', icon: <Zap className="h-3 w-3" />, label: 'Urgent', description: '< 24h until shift start' },
    { type: 'Planning', dot: '#EF4444', code: 'S3-S5', icon: <Flame className="h-3 w-3" />, label: 'Emergency', description: '< 4h until start (Locks S1 Publication)' },

    // LIVE — ARRIVAL BADGE
    { type: 'Live', dot: '#6366F1', code: 'S8', icon: <Hourglass className="h-3 w-3" />, label: 'Early In', description: 'Clocked in > 5m before start' },
    { type: 'Live', dot: '#22C55E', code: 'S8', icon: <Hourglass className="h-3 w-3" />, label: 'On Time In', description: 'Clocked in within 5m window' },
    { type: 'Live', dot: '#F59E0B', code: 'S8', icon: <Hourglass className="h-3 w-3" />, label: 'Late In', description: 'Clocked in > 5m after start' },
    { type: 'Live', dot: '#EAB308', code: 'S8', icon: <Clock className="h-3 w-3" />, label: 'Missing', description: 'Start time passed; no clock-in recorded' },
    { type: 'Terminal', dot: '#DC2626', code: 'S9', icon: <XCircle className="h-3 w-3" />, label: 'No Show', description: 'Shift ended; never clocked in' },

    // LIVE — DEPARTURE BADGE
    { type: 'Terminal', dot: '#14B8A6', code: 'S9', icon: <CheckCircle className="h-3 w-3" />, label: 'Early Out', description: 'Clocked out > 5m before scheduled end' },
    { type: 'Terminal', dot: '#22C55E', code: 'S9', icon: <CheckCircle className="h-3 w-3" />, label: 'On Time Out', description: 'Clocked out within 5m window' },
    { type: 'Terminal', dot: '#8B5CF6', code: 'S9', icon: <CheckCircle className="h-3 w-3" />, label: 'Late Out', description: 'Clocked out > 5m after scheduled end' },
    { type: 'Terminal', dot: '#F97316', code: 'S8', icon: <Clock className="h-3 w-3" />, label: 'Working Overtime', description: 'Still clocked in past scheduled end' },
    { type: 'Terminal', dot: '#A855F7', code: 'S9', icon: <CheckCircle className="h-3 w-3" />, label: 'Auto Clock-Out', description: 'System-enforced auto clock-out' },

    // SYSTEM SIGNALS
    { type: 'System', code: 'S6/S7', icon: <ArrowLeftRight className="h-3 w-3" />, label: 'Trading', description: 'Trade pending peer (S6) or manager (S7)' },
    { type: 'System', code: 'S5', icon: <Gavel className="h-3 w-3" />, label: 'Bidding', description: 'Open for employee expressions of interest' },
    { type: 'System', code: '-', icon: <ShieldAlert className="h-3 w-3" />, label: 'Violation', description: 'Compliance breech (Rest/Length/Skills)' },
    { type: 'System', code: '-', icon: <CopyPlus className="h-3 w-3" />, label: 'Template', description: 'Generated from an institutional roster' },
    { type: 'System', code: '-', icon: <Lock className="h-3 w-3" />, label: 'Locked', description: 'Locked by manager or institutional rule' },
];


// ============================================================================
// COMPONENT
// ============================================================================



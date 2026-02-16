
import { Shift } from '@/modules/rosters';

// --- Types ---
export type BidStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'selected';

export interface Bid {
    id: string;
    shift_id: string;
    employee_id: string;
    status: BidStatus;
    created_at: string;
    updated_at?: string;
    notes?: string;
    manager_notes?: string;
    shift?: Shift;
    employee?: {
        id: string;
        first_name: string;
        last_name: string;
        email: string;
    };
    employee_name?: string; // Virtual field for UI
}

export interface ShiftBid extends Bid { } // Alias for backward compatibility if needed

import { supabase } from '@/platform/realtime/client';
import { Shift } from '@/modules/rosters';
import { Bid, BidStatus } from '../model/bid.types';

// --- Helper Functions ---
const mapDbStatusToBidStatus = (dbStatus: string): BidStatus => {
    const map: Record<string, BidStatus> = {
        'pending': 'pending',
        'accepted': 'selected', // UI 'selected' matches DB 'accepted'
        'rejected': 'rejected',
        'withdrawn': 'withdrawn'
    };
    return map[dbStatus] || 'pending';
};

const mapBidStatusToDbStatus = (status: BidStatus): string => {
    const map: Record<BidStatus, string> = {
        'pending': 'pending',
        'selected': 'accepted',
        'accepted': 'accepted',
        'rejected': 'rejected',
        'withdrawn': 'withdrawn'
    };
    return map[status] || 'pending';
};

export const biddingApi = {
    /**
     * Fetch all bids (MANAGER VIEW dashboard)
     */
    async getAllBids(): Promise<Bid[]> {
        const { data, error } = await supabase
            .from('shift_bids')
            .select(`
                *,
                shift:shifts(*),
                employee:profiles!shift_bids_employee_id_fkey(id, first_name, last_name, email)
            `)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching all bids:', error);
            throw error;
        }

        return (data || []).map((row: any) => ({
            ...row,
            employee_name: row.employee ? `${row.employee.first_name} ${row.employee.last_name}` : 'Unknown'
        })) as Bid[];
    },

    /**
     * Fetch all shifts that are currently open for bidding (EMPLOYEE VIEW)
     * Enforces Access Control: Org -> Dept -> SubDept
     */
    async getOpenBidShifts(filters?: {
        organizationId?: string;
        departmentId?: string;
        subDepartmentId?: string;
    }): Promise<Shift[]> {
        let query = (supabase as any)
            .from('shifts')
            .select(`
                *,
                organizations(id, name),
                departments(id, name),
                sub_departments(id, name),
                roles(id, name),
                remuneration_levels(id, level_number, level_name, hourly_rate_min, hourly_rate_max)
            `)
            .in('bidding_status', ['on_bidding_normal', 'on_bidding_urgent'])
            .is('assigned_employee_id', null)
            .is('deleted_at', null);

        if (filters?.organizationId) {
            query = query.eq('organization_id', filters.organizationId);
        }

        if (filters?.subDepartmentId) {
            query = query.eq('sub_department_id', filters.subDepartmentId);
        } else if (filters?.departmentId) {
            query = query.eq('department_id', filters.departmentId);
        }

        const response = await query;
        const queryData = (response as any).data;
        const queryError = (response as any).error;

        if (queryError) {
            console.error('Error fetching open bid shifts:', queryError);
            throw queryError;
        }

        return (queryData || []).map((row: any) => ({
            ...row,
            is_urgent: row.bidding_status === 'on_bidding_urgent'
        })) as unknown as Shift[];
    },

    /**
     * Fetch bids submitted by the current user (EMPLOYEE VIEW)
     */
    async getMyBids(userId: string): Promise<Bid[]> {
        const { data, error } = await supabase
            .from('shift_bids')
            .select(`
                *,
                shift:shifts(
                    *,
                    organizations(name),
                    departments(name),
                    sub_departments(name),
                    roles(name),
                    remuneration_levels(level_name)
                )
            `)
            .eq('employee_id', userId)
            .neq('status', 'withdrawn')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching my bids:', error);
            throw error;
        }

        return data as unknown as Bid[];
    },

    /**
     * Fetch all bids for a specific shift (MANAGER VIEW)
     */
    async getBidsForShift(shiftId: string): Promise<Bid[]> {
        const { data, error } = await supabase
            .from('shift_bids')
            .select(`
                *,
                employee:profiles!shift_bids_employee_id_fkey(id, first_name, last_name, email)
            `)
            .eq('shift_id', shiftId);

        if (error) {
            console.error(`Error fetching bids for shift ${shiftId}:`, error);
            throw error;
        }

        return (data || []).map((row: any) => ({
            ...row,
            employee_name: row.employee ? `${row.employee.first_name} ${row.employee.last_name}` : 'Unknown'
        })) as Bid[];
    },

    /**
     * Place a bid on a shift (EMPLOYEE ACTION)
     */
    async placeBid(shiftId: string, userId: string, notes?: string): Promise<Bid> {
        const { data, error } = await supabase
            .from('shift_bids')
            .upsert({
                shift_id: shiftId,
                employee_id: userId,
                status: 'pending',
                notes: notes,
                created_at: new Date().toISOString()
            } as any, { onConflict: 'shift_id, employee_id' })
            .select()
            .single();

        if (error) {
            console.error('Error placing bid:', error);
            throw error;
        }
        return data as Bid;
    },

    /**
     * Withdraw a bid (EMPLOYEE ACTION)
     */
    async withdrawBid(bidId: string): Promise<void> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { error } = await supabase.rpc('withdraw_bid_rpc' as any, {
            p_bid_id: bidId,
            p_employee_id: user.id
        });

        if (error) throw error;
    },

    /**
     * Update bid status (MANAGER ACTION)
     */
    async updateBidStatus(id: string, status: BidStatus): Promise<Bid> {
        const dbStatus = mapBidStatusToDbStatus(status);

        const { data, error } = await supabase
            .from('shift_bids')
            .update({ status: dbStatus } as any) // Cast to any to avoid enum mismatch with generated types
            .eq('id', id)
            .select()
            .single();

        if (error) {
            console.error(`Error updating bid status for ${id}:`, error);
            throw error;
        }

        // If selected, we might need to reject others. 
        // Ideally this should be an RPC to ensure atomicity.
        if (status === 'selected' || status === 'accepted') {
            // We won't block the UI for this, but worth sending a request to reject others
            // or rely on a DB trigger.
            const shiftId = (data as any).shift_id;
            await supabase
                .from('shift_bids')
                .update({ status: 'rejected' } as any)
                .eq('shift_id', shiftId)
                .neq('id', id)
                .eq('status', 'pending');
        }

        return data as Bid;
    },

    /**
     * Bulk update bid status (MANAGER ACTION)
     */
    async updateBulkBidStatus(ids: string[], status: BidStatus): Promise<void> {
        const dbStatus = mapBidStatusToDbStatus(status);
        const { error } = await supabase
            .from('shift_bids')
            .update({ status: dbStatus } as any)
            .in('id', ids);

        if (error) throw error;
    }
};

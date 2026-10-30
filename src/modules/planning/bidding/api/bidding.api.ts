import { supabase } from '@/platform/supabase/client';
import { Shift } from '@/modules/rosters';
import { Bid } from '../model/bid.types';

// --- Helper Functions ---


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
        departmentId?: string | string[];
        subDepartmentId?: string | string[];
    }): Promise<Shift[]> {
        const toIdList = (v: string | string[] | undefined): string[] => {
            if (!v) return [];
            return Array.isArray(v) ? v.filter(Boolean) : [v];
        };
        const subDeptIds = toIdList(filters?.subDepartmentId);
        const deptIds = toIdList(filters?.departmentId);

        // Refuse unscoped queries: callers must supply at least one dept or sub-dept
        // bound. An empty-array filter previously fell through to "no scope filter",
        // returning every open bid shift in the org — a scope leak.
        if (subDeptIds.length === 0 && deptIds.length === 0) {
            return [];
        }

        let query = (supabase as any)
            .from('shifts')
            .select(`
                *,
                dropped_by_id,
                last_dropped_by,
                my_shift_pay_terms,
                organizations(id, name),
                departments(id, name),
                sub_departments(id, name),
                roles(id, name),
                remuneration_levels(level_number, level_name)
            `)
            .in('bidding_status', ['on_bidding_normal', 'on_bidding_urgent', 'on_bidding'])
            .is('assigned_employee_id', null);

        if (filters?.organizationId) {
            query = query.eq('organization_id', filters.organizationId);
        }

        if (subDeptIds.length > 0) {
            query = query.in('sub_department_id', subDeptIds);
        } else {
            query = query.in('department_id', deptIds);
        }

        const response = await query;
        const queryData = (response as any).data;
        const queryError = (response as any).error;

        if (queryError) {
            console.error('Error fetching open bid shifts:', queryError);
            throw queryError;
        }

        // Urgency is derived from time-to-start at read time by consumers
        // (computeShiftUrgency); no persisted is_urgent column.
        return (queryData || []) as unknown as Shift[];
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
                    my_shift_pay_terms,
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

        // Return all non-withdrawn bids, including past accepted bids.
        // History rendering depends on seeing the winning bid from a round where
        // the employee was selected and later dropped the shift. Filtering it out
        // caused the history to show DNB instead of Accepted for that round.
        // The participation status is now derived from last_dropped_by + current
        // iteration, so stale accepted bids don't pollute the active state.
        return data as unknown as Bid[];
    },

    /**
     * Place a bid on a shift (EMPLOYEE ACTION)
     */
    async placeBid(shiftId: string, userId: string, notes?: string): Promise<Bid> {
        // Check for decliner exclusion: if this employee dropped or rejected the offer,
        // they are barred from re-bidding on this specific shift.
        const { data: shiftExclusion, error: shiftError } = await supabase
            .from('shifts')
            .select('last_dropped_by, last_rejected_by')
            .eq('id', shiftId)
            .single();

        if (shiftError) {
            console.error('[bidding] Error checking exclusion:', shiftError);
        }

        if (shiftExclusion) {
            const ex = shiftExclusion as any;
            if (ex.last_dropped_by === userId || ex.last_rejected_by === userId) {
                throw new Error(
                    'You dropped or rejected this shift. Re-bidding is not permitted.'
                );
            }
        }

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
};

import { supabase } from '@/platform/supabase/client';
import { SwapRequestWithDetails } from '../model/swap.types';
import { isValidUuid } from '@/modules/rosters/domain/shift.entity';

import { shiftsApi } from '@/modules/rosters';
import { applyShiftOp } from '@/modules/rosters/api/shifts.api';
import { mapShiftOpResultToUx } from '@/modules/rosters/domain/shift-ops.contract';
import { ShiftTimeRange, swapEvaluator, runSwapGuards, SwapGuardError } from '@/modules/compliance';
import { fetchV8EmployeeContext } from '@/modules/compliance/employee-context';
import { addDays, subDays, format, parseISO, differenceInHours, parse } from 'date-fns';

// Audit C-4: the swap engine's SwapPartyInput.contract_type uses the
// shorthand 'FT' | 'PT' | 'CASUAL' union; fetchV8EmployeeContext (the
// same helper the manager-approval orchestrator uses) returns the V2
// orchestrator's 'FULL_TIME' | 'PART_TIME' | 'CASUAL' | 'STUDENT_VISA'.
// Map between them rather than introduce a second contract-type
// vocabulary. STUDENT_VISA workers in this venue are casual/part-time
// by award structure and the underlying FT/PT/CASUAL value is not
// preserved once STUDENT_VISA overrides it upstream, so fall back to
// the safe, previously-universal default (CASUAL) for that case only.
const toSwapEngineContractType = (
    t: 'FULL_TIME' | 'PART_TIME' | 'CASUAL' | 'STUDENT_VISA' | null | undefined,
): 'FT' | 'PT' | 'CASUAL' | null => {
    switch (t) {
        case 'FULL_TIME': return 'FT';
        case 'PART_TIME': return 'PT';
        case 'CASUAL': return 'CASUAL';
        case 'STUDENT_VISA': return 'CASUAL';
        default: return null;
    }
};

// Type assertion helper for Supabase queries with tables not in generated types
const db = supabase as any;

// §9 Time Lock: Swap actions are forbidden if shift starts within 4 hours
const TIME_LOCK_HOURS = 4;
import { parseZonedDateTime } from '@/modules/core/lib/date.utils';

const assertNotTimeLocked = (shiftDate: string, startTime: string): Date => {
    // Use centralized date utilities to handle timezone parsing correctly
    const shiftStart = parseZonedDateTime(shiftDate, startTime);
    const now = new Date();

    // Calculate absolute difference in hours
    const hoursUntilStart = differenceInHours(shiftStart, now);

    if (hoursUntilStart < TIME_LOCK_HOURS) {
        throw new Error(`Time locked: shift starts in ${hoursUntilStart}h (< ${TIME_LOCK_HOURS}h). Swap actions are forbidden.`);
    }
    // Also block if shift is in the past
    if (hoursUntilStart < 0) {
        throw new Error(`Time locked: shift has already started. Swap actions are forbidden.`);
    }
    return shiftStart;
};

/**
 * Validate swap compliance using the Constraint Solver.
 *
 * Replaces sequential per-employee rule checks with a simultaneous scenario
 * evaluation — all constraints applied to both parties' hypothetical schedules
 * at once.
 *
 * @returns SolverResult (feasible = no blocking violations for either party)
 */
const validateSwapCompliance = async (
    requesterId: string,
    requesterShift: any,
    offererId: string,
    offeredShift: any,
    options: { swapId?: string; shiftSnapshot?: Array<{ id: string; shift_date: string; start_time: string; end_time: string }> } = {}
) => {
    const dateRef = parse(requesterShift.shift_date, 'yyyy-MM-dd', new Date());
    const start = format(subDays(dateRef, 30), 'yyyy-MM-dd');
    const end = format(addDays(dateRef, 30), 'yyyy-MM-dd');

    // Fetch rosters AND real employment context for BOTH parties (cross-
    // department — no department filter). Audit C-4: this compliance
    // check previously never fetched contract_type/contracted_weekly_hours/
    // leave_days at all, so every swap silently ran through the engine as
    // if both parties were CASUAL regardless of their real employment type.
    const [requesterRoster, offererRoster, requesterCtx, offererCtx] = await Promise.all([
        shiftsApi.getEmployeeShifts(requesterId, start, end),
        shiftsApi.getEmployeeShifts(offererId, start, end),
        fetchV8EmployeeContext(requesterId),
        fetchV8EmployeeContext(offererId),
    ]);

    // Pre-flight guards: entity validity, concurrency, locks, drift (#1, #2, #16, #20, #21)
    const guardResult = await runSwapGuards({
        shiftIds: [requesterShift.id, offeredShift?.id].filter(Boolean),
        employeeIds: [requesterId, offererId],
        currentSwapId: options.swapId,
        shiftSnapshot: options.shiftSnapshot,
    });

    if (!guardResult.passed) throw new SwapGuardError(guardResult);

    // Map rosters to ShiftTimeRange[]
    const toTimeRange = (s: any): ShiftTimeRange => ({
        shift_date: s.shift_date,
        start_time: s.start_time,
        end_time: s.end_time,
        unpaid_break_minutes: s.unpaid_break_minutes || 0,
    });

    // Run the constraint solver — all 8 constraints simultaneously on both parties
    const solverResult = swapEvaluator.evaluate({
        partyA: {
            employee_id: requesterId,
            name: 'Requester',
            current_shifts: requesterRoster.map(s => ({ ...toTimeRange(s), id: s.id })) as any,
            shift_to_give: { ...toTimeRange(requesterShift), id: requesterShift.id } as any,
            contract_type: toSwapEngineContractType(requesterCtx.contract_type),
            contracted_weekly_hours: requesterCtx.contracted_weekly_hours || undefined,
            leave_days: requesterCtx.leave_days,
            is_security_role: requesterCtx.is_security_role,
        },
        partyB: {
            employee_id: offererId,
            name: 'Offerer',
            current_shifts: offererRoster.map(s => ({ ...toTimeRange(s), id: s.id })) as any,
            shift_to_give: { ...toTimeRange(offeredShift), id: offeredShift?.id } as any,
            contract_type: toSwapEngineContractType(offererCtx.contract_type),
            contracted_weekly_hours: offererCtx.contracted_weekly_hours || undefined,
            leave_days: offererCtx.leave_days,
            is_security_role: offererCtx.is_security_role,
        },
    });

    return {
        solverResult,
        feasible: solverResult.feasible,
        timestamp: new Date().toISOString(),
    };
};

// ShiftSwap interface for MySwaps page (matches DB structure more closely)
export interface ShiftSwap {
    id: string;
    requester_shift_id: string;
    requester_id: string; // FK to profiles
    target_id: string | null; // FK to profiles
    target_shift_id: string | null;
    reason: string | null;
    status: 'OPEN' | 'MANAGER_PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
    priority?: 'NORMAL' | 'URGENT' | 'EMERGENT' | null;
    created_at: string;
    updated_at: string;
}

// Type for creating swap requests
export interface CreateSwapData {
    requesterV8ShiftId: string;
    requestedByEmployeeId: string;
    swapWithEmployeeId?: string | null;
    reason?: string | null;
}

// Extended interface with relations
export interface ShiftSwapRelations extends ShiftSwap {
    requester_shift?: any; // Was original_shift
    target_shift?: any;   // Was offered_shift
    requested_by?: any; // profile
    swap_with?: any; // profile
}

// Interface for an offer received on a swap request (1-to-many model)
export interface SwapOffer {
    id: string;
    swap_request_id: string;
    offerer_id: string;
    offered_shift_id?: string;
    status: 'SUBMITTED' | 'SELECTED' | 'REJECTED' | 'WITHDRAWN' | 'EXPIRED';
    compliance_snapshot?: any;
    created_at: string;
    offerer?: any; // Profile relation
    offered_shift?: any; // Shift relation
}

export const swapsApi = {
    // ----------------------------------------------------------------
    // 1. CREATE
    // ----------------------------------------------------------------

    /**
     * Create a new swap request.
     */
    async createSwapRequest(
        requesterV8ShiftId: string,
        requestedByEmployeeId: string,
        swapWithEmployeeId: string | null = null,
        reason: string | null = null
    ): Promise<ShiftSwap> {
        console.log('[API] Creating swap request:', { requesterV8ShiftId, requestedByEmployeeId, swapWithEmployeeId });

        // §9 Time Lock Check (client-side fast-path for a friendly error). The
        // RPC below re-checks the lock atomically on the server.
        const { data: shift, error: shiftErr } = await supabase
            .from('shifts').select('shift_date, start_time').eq('id', requesterV8ShiftId).single();
        if (shiftErr || !shift) throw shiftErr || new Error('Shift not found');
        assertNotTimeLocked(shift.shift_date, shift.start_time);

        // Atomic create via the definer RPC: inserts the OPEN request (the
        // trg_set_swap_expires_at trigger stamps expires_at) AND flips the shift
        // to TradeRequested (S4 → S9) in a single transaction — closing the
        // orphaned-state hole the old two-step client write had. The server
        // derives the requester from auth.uid() and verifies shift ownership,
        // so requestedByEmployeeId is no longer trusted from the client.
        void requestedByEmployeeId;
        const { data: rpcResult, error: rpcError } = await db.rpc('sm_create_swap_request', {
            p_requester_shift_id: requesterV8ShiftId,
            p_target_id: swapWithEmployeeId,
            p_reason: reason,
        });
        if (rpcError) {
            console.error('[API] Error creating swap request:', rpcError);
            throw rpcError;
        }
        if (!rpcResult?.success) {
            throw new Error(rpcResult?.error ?? 'Failed to create swap request');
        }

        const { data: created, error: fetchErr } = await db
            .from('shift_swaps').select('*').eq('id', rpcResult.swap_id).single();
        if (fetchErr) throw fetchErr;
        return created;
    },

    // ----------------------------------------------------------------
    // 2. READ
    // ----------------------------------------------------------------

    /**
     * Get all swap requests for a specific employee.
     */
    /**
     * Get all swap requests for a specific employee.
     * Optionally filtered by Organization (for Header context awareness)
     */
    async getMySwaps(employeeId: string, filters?: { organizationId?: string }): Promise<ShiftSwapRelations[]> {
        // 1. Fetch Request where I am the requester
        let requestsQuery = db
            .from('shift_swaps')
            .select(`
                *,
                requester_shift:shifts!requester_shift_id(
                    *,
                    roles(name),
                    departments(name),
                    sub_departments(name),
                    organizations(name)
                ),
                target_shift:shifts!target_shift_id(
                    *,
                    roles(name),
                    departments(name),
                    sub_departments(name),
                    organizations(name)
                ),
                requested_by:profiles!requester_id(*),
                swap_with:profiles!target_id(*)
            `)
            .eq('requester_id', employeeId);

        // 2. Fetch Offers I made (from swap_offers table)
        // We need the PARENT swap request details for these.
        const offersQuery = db
            .from('swap_offers')
            .select(`
                *,
                swap_request:shift_swaps!swap_request_id(
                    *,
                    requester_shift:shifts!requester_shift_id(
                        *,
                        roles(name),
                        departments(name),
                        sub_departments(name),
                        organizations(name)
                    ),
                    target_shift:shifts!target_shift_id(
                        *,
                        roles(name),
                        departments(name),
                        sub_departments(name),
                        organizations(name)
                    ),
                    requested_by:profiles!requester_id(*),
                    swap_with:profiles!target_id(*)
                ),
                offered_shift:shifts!offered_shift_id(
                    id, shift_date, start_time, end_time, paid_break_minutes, unpaid_break_minutes, net_length_minutes, lifecycle_status, group_type,
                    roles(name),
                    remuneration_levels(hourly_rate_min),
                    departments(name),
                    sub_departments(name),
                    organizations(name)
                )
            `)
            .eq('offerer_id', employeeId);

        if (filters?.organizationId) {
            requestsQuery = requestsQuery.eq('requester_shift.organization_id', filters.organizationId);
            // For offers, we filter on the parent swap's shift org
            // Note: nested filtering in PostgREST is tricky.
            // We'll filter in memory for simplicity or rely on the primary query structure.
        }

        const [requestsResult, offersResult] = await Promise.all([requestsQuery, offersQuery]);

        if (requestsResult.error) throw requestsResult.error;
        if (offersResult.error) throw offersResult.error;

        const myRequests = requestsResult.data || [];

        // Extract swap requests from my offers
        const myOffersAsSwaps = (offersResult.data || [])
            .map((o: any) => {
                const swapReq = o.swap_request;
                if (!swapReq) return null;
                
                // Attach the offer details to the parent swap request so the UI can read myOffer?.status
                swapReq.swap_offers = swapReq.swap_offers || [];
                swapReq.swap_offers.push({
                    id: o.id,
                    swap_request_id: o.swap_request_id,
                    offerer_id: o.offerer_id,
                    offered_shift_id: o.offered_shift_id,
                    offered_shift: o.offered_shift,
                    status: o.status,
                    created_at: o.created_at
                });

                return swapReq;
            })
            .filter((s: any) => s !== null);

        // Deduplicate (unlikely to overlap unless I offered on my own request?)
        const allSwaps = [...myRequests, ...myOffersAsSwaps];
        const uniqueSwaps = Array.from(new Map(allSwaps.map(item => [item.id, item])).values());

        return (uniqueSwaps.map(mapDbToSwapRequest) as unknown) as ShiftSwapRelations[];
    },

    /**
     * Get available swap requests (Marketplace).
     */
    /**
     * Get available swap requests (Marketplace).
     */
    async getAvailableSwaps(
        currentEmployeeId: string,
        filters: {
            organizationId: string;
            departmentId?: string | string[];
            subDepartmentId?: string | string[];
        }
    ): Promise<ShiftSwapRelations[]> {
        const { organizationId, departmentId, subDepartmentId } = filters;
        const shiftJoinType = '!inner'; // Mandatory to filter by org

        let query = db
            .from('shift_swaps')
            .select(`
                *,
                requester_shift:shifts!requester_shift_id${shiftJoinType}(
                    *,
                    roles(name),
                    departments(name),
                    sub_departments(name),
                    organizations(name)
                ),
                target_shift:shifts!target_shift_id(
                    *,
                    roles(name),
                    departments(name),
                    sub_departments(name),
                    organizations(name)
                ),
                requested_by:profiles!requester_id(*),
                swap_with:profiles!target_id(*)
            `)
            .eq('status', 'OPEN')
            .is('target_id', null)
            .neq('requester_id', currentEmployeeId)
            .eq('requester_shift.organization_id', organizationId);

        // Hierarchy Filters
        if (subDepartmentId) {
            if (Array.isArray(subDepartmentId) && subDepartmentId.length > 0) {
                query = query.in('requester_shift.sub_department_id', subDepartmentId);
            } else if (typeof subDepartmentId === 'string' && isValidUuid(subDepartmentId)) {
                query = query.eq('requester_shift.sub_department_id', subDepartmentId);
            }
        } else if (departmentId) {
            if (Array.isArray(departmentId) && departmentId.length > 0) {
                query = query.in('requester_shift.department_id', departmentId);
            } else if (typeof departmentId === 'string' && isValidUuid(departmentId)) {
                query = query.eq('requester_shift.department_id', departmentId);
            }
        }

        const { data, error } = await query;

        if (error) {
            console.error('[API] Error fetching available swaps:', error);
            throw error;
        }

        console.log('[API LOG] Fetched swaps count:', data?.length || 0);
        return (data || []).map(mapDbToSwapRequest);
    },

    /**
     * Get a single swap request by ID with full details
     */
    async getSwapById(swapId: string): Promise<SwapRequestWithDetails | null> {
        const { data, error } = await db
            .from('shift_swaps')
            .select(`
                *,
                requester_shift:shifts!requester_shift_id(
                    *,
                    roles(name),
                    departments(name),
                    sub_departments(name),
                    organizations(name)
                ),
                target_shift:shifts!target_shift_id(
                    *,
                    roles(name),
                    departments(name),
                    sub_departments(name),
                    organizations(name)
                ),
                requested_by:profiles!requester_id(*),
                swap_with:profiles!target_id(*)
            `)
            .eq('id', swapId)
            .single();

        if (error) throw error;
        return data ? mapDbToSwapRequest(data) : null;
    },

    /**
     * Get offers for a specific swap request.
     * TODO: Implement actual DB fetch when swap_offers table exists.
     */
    /**
     * Make an offer on a swap request (1-to-many model).
     * Inserts a new row into swap_offers.
     */
    async makeOffer(swapId: string, targetV8ShiftId: string | undefined, targetId: string): Promise<void> {
        console.log('[API] Making offer on swap:', { swapId, targetV8ShiftId, targetId });

        // Self-offer guard: prevent a user from offering on their own swap request.
        // Also fetch the REQUESTER's shift so we can enforce §9 on the request
        // itself — an offer must never be lodged against a shift already < 4h out,
        // even for a giveaway offer (no offered shift).
        const { data: swapMeta, error: swapMetaErr } = await db
            .from('shift_swaps')
            .select('requester_id, requester_shift:shifts!requester_shift_id(shift_date, start_time)')
            .eq('id', swapId)
            .single();
        if (swapMetaErr || !swapMeta) throw swapMetaErr || new Error('Swap request not found');
        if (swapMeta.requester_id === targetId) {
            throw new Error('You cannot make an offer on your own swap request.');
        }

        // §9 Time Lock Check (requester shift): ALWAYS guard the shift being
        // offered on — including giveaway offers with no offered_shift_id.
        const requesterShift = Array.isArray(swapMeta.requester_shift)
            ? swapMeta.requester_shift[0]
            : swapMeta.requester_shift;
        if (!requesterShift?.shift_date || !requesterShift?.start_time) {
            throw new Error('Cannot make an offer: requester shift date/time is missing.');
        }
        assertNotTimeLocked(requesterShift.shift_date, requesterShift.start_time);

        const offerData: any = {
            swap_request_id: swapId,
            offerer_id: targetId,
            status: 'SUBMITTED',
        };

        // §9 Time Lock Check: Prevent offering a shift that starts within 4 hours
        if (targetV8ShiftId) {
            const { data: shift, error: shiftErr } = await supabase
                .from('shifts').select('shift_date, start_time').eq('id', targetV8ShiftId).single();
            if (shiftErr || !shift) throw shiftErr || new Error('Shift not found');
            assertNotTimeLocked(shift.shift_date, shift.start_time);
            
            offerData.offered_shift_id = targetV8ShiftId;
        }

        const { error } = await db
            .from('swap_offers')
            .insert(offerData);

        if (error) {
            console.error('[API] Error making offer:', error);
            throw error;
        }

    },

    /**
     * Get swap request IDs where the current user has an active (SUBMITTED) offer.
     * Used to show "Already Offered" state on Available Swaps cards.
     * Only considers offers on swaps that are still active (OPEN or MANAGER_PENDING).
     */
    async getMyActiveOffers(employeeId: string): Promise<Set<string>> {
        const { data, error } = await db
            .from('swap_offers')
            .select('swap_request_id, active_swap:shift_swaps!inner(status)')
            .eq('offerer_id', employeeId)
            .eq('status', 'SUBMITTED')
            .in('active_swap.status', ['OPEN', 'MANAGER_PENDING']);

        if (error) {
            console.error('[API] Error fetching my active offers:', error);
            return new Set();
        }

        return new Set((data || []).map((o: any) => o.swap_request_id));
    },

    /**
     * Get full offer details for the current user's active offers.
     * Used by OfferSwapModal to determine which shifts are already offered elsewhere.
     * Only considers offers on swaps that are still active (OPEN or MANAGER_PENDING).
     */
    async getMyActiveOfferDetails(employeeId: string): Promise<{ swap_request_id: string; offered_shift_id: string | null }[]> {
        const { data, error } = await db
            .from('swap_offers')
            .select('swap_request_id, offered_shift_id, active_swap:shift_swaps!inner(status)')
            .eq('offerer_id', employeeId)
            .eq('status', 'SUBMITTED')
            .in('active_swap.status', ['OPEN', 'MANAGER_PENDING']);

        if (error) {
            console.error('[API] Error fetching my active offer details:', error);
            return [];
        }

        return data || [];
    },

    /**
     * Get offers for a specific swap request.
     * Fetches from swap_offers table.
     */
    async getSwapOffers(swapId: string): Promise<SwapOffer[]> {
        console.log('[API] Fetching offers for swap:', swapId);

        const { data, error } = await db
            .from('swap_offers')
            .select(`
                *,
                offerer:profiles!offerer_id(*),
                offered_shift:shifts!offered_shift_id(
                    id, shift_date, start_time, end_time, paid_break_minutes, unpaid_break_minutes, net_length_minutes, lifecycle_status, group_type,
                    roles(name),
                    remuneration_levels(hourly_rate_min),
                    departments(name),
                    sub_departments(name),
                    organizations(name)
                )
            `)
            .eq('swap_request_id', swapId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[API] Error fetching swap offers:', error);
            return [];
        }

        return (data || []).map(offer => ({
            ...offer,
            offerer: mapDbEmployee(offer.offerer),
            offered_shift: mapDbShift(offer.offered_shift)
        }));
    },

    /**
     * Fetch all swap requests (MANAGER VIEW)
     */
    async fetchSwapRequests(filters: {
        status?: string;
        organizationId: string; // Mandatory for managers
        departmentId?: string | string[];
        subDepartmentId?: string | string[];
    }): Promise<SwapRequestWithDetails[]> {
        console.log('[API] Fetching all swap requests with filters:', filters);

        const { organizationId, departmentId, subDepartmentId } = filters;

        // Conditional inner join usage for filtering
        // If filtering by subDepartmnent, ensure inner join on that.
        // Organization is mandatory base filter.
        const shiftJoinType = '!inner';

        let query = db
            .from('shift_swaps')
            .select(`
                *,
                requester_shift:shifts!requester_shift_id${shiftJoinType}(
                    *,
                    roles(name),
                    remuneration_levels(hourly_rate_min),
                    departments(name),
                    sub_departments(name),
                    organizations(name)
                ),
                target_shift:shifts!target_shift_id(
                    *,
                    roles(name),
                    remuneration_levels(hourly_rate_min),
                    departments(name),
                    sub_departments(name),
                    organizations(name)
                ),
                requested_by:profiles!requester_id(*),
                swap_with:profiles!target_id(*),
                swap_offers (
                    id,
                    status,
                    compliance_snapshot,
                    offered_shift_id,
                    offerer_id,
                    offered_shift:shifts!offered_shift_id(
                        id, shift_date, start_time, end_time, unpaid_break_minutes, lifecycle_status, group_type,
                        roles(name),
                        departments(name),
                        sub_departments(name),
                        organizations(name)
                    ),
                    offerer:profiles!offerer_id(id, first_name, last_name, avatar_url)
                )
            `)
            .eq('requester_shift.organization_id', organizationId)
            .order('created_at', { ascending: false });

        if (filters?.status && filters.status !== 'all') {
            query = query.eq('status', filters.status);
        }

        // Hierarchy Filters
        if (subDepartmentId) {
            if (Array.isArray(subDepartmentId) && subDepartmentId.length > 0) {
                query = query.in('requester_shift.sub_department_id', subDepartmentId);
            } else if (typeof subDepartmentId === 'string' && isValidUuid(subDepartmentId)) {
                query = query.eq('requester_shift.sub_department_id', subDepartmentId);
            }
        } else if (departmentId) {
            if (Array.isArray(departmentId) && departmentId.length > 0) {
                query = query.in('requester_shift.department_id', departmentId);
            } else if (typeof departmentId === 'string' && isValidUuid(departmentId)) {
                query = query.eq('requester_shift.department_id', departmentId);
            }
        }

        const { data, error } = await query;

        if (error) {
            console.error('[API] Error fetching swap requests:', error);
            throw error;
        }

        console.log('[API LOG] Fetched manager swaps count:', data?.length || 0);
        return (data || []).map(mapDbToSwapRequest);
    },

    // ----------------------------------------------------------------
    // 3. UPDATE (Actions)
    // ----------------------------------------------------------------

    async approveSwapRequest(requestId: string): Promise<void> {
        // 1. Get the swap details — shift_swaps is AUTHORITATIVE (§10 Invariant 3)
        const swap = await this.getSwapById(requestId);
        if (!swap) throw new Error("Swap request not found");

        // §9 Time Lock Check
        if (swap.originalShift?.shift_date && swap.originalShift?.start_time) {
            assertNotTimeLocked(swap.originalShift.shift_date, swap.originalShift.start_time);
        }

        // 2. Resolve target employee — shift_swaps.target_id is authoritative
        const effectiveTargetId = swap.swap_with_employee_id;
        if (!effectiveTargetId) {
            throw new Error("No target employee on this swap request. Was an offer selected?");
        }

        // 3. Resolve offered shift — shift_swaps.target_shift_id is authoritative, offer is fallback
        let offeredV8ShiftId = swap.offered_shift_id;
        let offeredShiftData: any = null;

        // Best-effort: try to find the offer for compliance snapshot
        const { data: offerData } = await db
            .from('swap_offers')
            .select('*, offered_shift:shifts!offered_shift_id(*)')
            .eq('swap_request_id', requestId)
            .eq('offerer_id', effectiveTargetId)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (offerData) {
            offeredShiftData = offerData.offered_shift;
            if (!offeredV8ShiftId) offeredV8ShiftId = offerData.offered_shift_id;
        }

        // If still no offered shift data, fetch directly from shifts table
        if (!offeredShiftData && offeredV8ShiftId) {
            const { data: shiftRow } = await db.from('shifts').select('*').eq('id', offeredV8ShiftId).single();
            offeredShiftData = shiftRow;
        }

        // §9 Time Lock: also guard the offered shift — both shifts must be > 4h away
        if (offeredShiftData?.shift_date && offeredShiftData?.start_time) {
            assertNotTimeLocked(offeredShiftData.shift_date, offeredShiftData.start_time);
        }

        // 4. Re-Verify Compliance at approval time with drift check (#2, #22)
        // Snapshot the original shift times so the drift guard can detect schedule changes
        const shiftSnapshot = [
            swap.originalShift && {
                id: swap.original_shift_id,
                shift_date: swap.originalShift.shift_date ?? swap.originalShift.shiftDate,
                start_time: swap.originalShift.start_time ?? swap.originalShift.startTime,
                end_time: swap.originalShift.end_time ?? swap.originalShift.endTime,
            },
            offeredShiftData && {
                id: offeredV8ShiftId,
                shift_date: offeredShiftData.shift_date,
                start_time: offeredShiftData.start_time,
                end_time: offeredShiftData.end_time,
            },
        ].filter(Boolean) as Array<{ id: string; shift_date: string; start_time: string; end_time: string }>;

        const complianceCheck = await validateSwapCompliance(
            swap.requested_by_employee_id,
            swap.originalShift,
            effectiveTargetId,
            offeredShiftData,
            { swapId: requestId, shiftSnapshot }
        );

        if (!complianceCheck.feasible) {
            const blockers = complianceCheck.solverResult.violations
                .filter(v => v.blocking)
                .map(v => `[${v.employee_name}] ${v.summary}`)
                .join('; ');
            throw new Error(`Compliance violation detected. Cannot approve swap. ${blockers}`);
        }

        // 5+6. Execute via the shift-mutation gateway (optimistic concurrency) — §4 T5.
        // Compliance was just verified above, so we assert compliance_ok. The gateway
        // resolves the MANAGER_PENDING shift_swaps row, delegates the 2-way (or
        // giveaway) reassignment to sm_approve_peer_swap using the row's own ids,
        // marks the swap APPROVED, and version-guards the requester shift — closing
        // the concurrent double-approve hole the old direct update had (it lacked a
        // status guard). S10 ↔ MANAGER_PENDING is kept in sync by sm_accept_trade.
        // Optimistic-concurrency basis must be the version the view was loaded at
        // (a stale view should correctly conflict). Never silently fall back to 0
        // — that forces a confusing VERSION_CONFLICT since versions start at 1.
        const expectedVersion = swap.originalShift?.version;
        if (expectedVersion == null) {
            throw new Error('Could not determine the shift version. Please refresh and try again.');
        }
        const approveResult = await applyShiftOp({
            shiftId: swap.original_shift_id,
            expectedVersion,
            op: 'approve_trade',
            payload: { compliance_ok: true },
        });

        if (!approveResult.ok) {
            console.error('[API] approve_trade gateway rejected:', approveResult);
            throw new Error(mapShiftOpResultToUx(approveResult).toast ?? 'Could not approve swap.');
        }
    },

    async rejectSwapRequest(requestId: string, reason?: string): Promise<void> {
        // §4 T6: Only allowed from MANAGER_PENDING. Also fetch the requester shift's
        // version for the gateway's optimistic CAS.
        const { data, error: fetchErr } = await db
            .from('shift_swaps')
            .select('status, requester_shift_id, requester_shift:shifts!requester_shift_id(version)')
            .eq('id', requestId).single();
        if (fetchErr || !data) throw fetchErr || new Error('Swap not found');
        if (data.status !== 'MANAGER_PENDING') {
            throw new Error(`Cannot reject swap in state '${data.status}'. Must be MANAGER_PENDING.`);
        }

        // Execute via the shift-mutation gateway: it flips the shift_swaps row to
        // REJECTED and reverts BOTH shifts to NoTrade, with version-CAS + an
        // actor-stamped audit event. (S10 ↔ MANAGER_PENDING is kept in sync by
        // sm_accept_trade, so the gateway's S10 FSM guard is satisfied.)
        const requesterShift = Array.isArray(data.requester_shift)
            ? data.requester_shift[0]
            : data.requester_shift;
        const expectedVersion = requesterShift?.version;
        if (expectedVersion == null) {
            throw new Error('Could not determine the shift version. Please refresh and try again.');
        }
        const result = await applyShiftOp({
            shiftId: data.requester_shift_id,
            expectedVersion,
            op: 'reject_trade',
            payload: { reason: reason ?? 'Manager Action' },
        });
        if (!result.ok) {
            throw new Error(mapShiftOpResultToUx(result).toast ?? 'Could not reject swap.');
        }
    },

    async cancelSwapRequest(swapId: string): Promise<void> {
        console.log('[API] Cancelling swap:', swapId);

        // §4 T7: atomic cancel via the definer RPC — flips the swap to CANCELLED
        // and reverts the shift to NoTrade (S9 → S4) in one transaction, with the
        // OPEN-only state guard (returns "Must be OPEN") and requester/manager
        // authorization enforced server-side.
        const { data: rpcResult, error } = await db.rpc('sm_cancel_swap_request', {
            p_swap_id: swapId,
        });
        if (error) throw error;
        if (!rpcResult?.success) {
            throw new Error(rpcResult?.error ?? 'Failed to cancel swap');
        }
    },

    async acceptTrade(swapId: string, offerId: string, offererId: string, offerV8ShiftId?: string): Promise<void> {
        console.log('[API] Accepting trade:', { swapId, offerId, offererId, offerV8ShiftId });

        // 1. Fetch Swap Request to check status (Optimistic Locking)
        const { data: swapRequest, error: fetchError } = await db
            .from('shift_swaps')
            .select('*, requester_shift:shifts!requester_shift_id(*)')
            .eq('id', swapId)
            .single();

        if (fetchError || !swapRequest) throw fetchError || new Error("Swap request not found");

        if (swapRequest.status !== 'OPEN') {
            throw new Error("Swap request is no longer OPEN. It may have been accepted or cancelled.");
        }

        // 2. Run Compliance Check for Snapshot
        // §9 Time Lock Check
        assertNotTimeLocked(
            swapRequest.requester_shift.shift_date,
            swapRequest.requester_shift.start_time
        );

        let offeredShift: any = null;
        if (offerV8ShiftId) {
            const { data: shift } = await supabase.from('shifts').select('*').eq('id', offerV8ShiftId).single();
            offeredShift = shift;
        }

        const complianceSnapshot = await validateSwapCompliance(
            swapRequest.requester_id,
            swapRequest.requester_shift,
            offererId,
            offeredShift,
            { swapId: swapId }
        );

        if (!complianceSnapshot.feasible) {
            const blockers = complianceSnapshot.solverResult.violations
                .filter(v => v.blocking)
                .map(v => `[${v.employee_name}] ${v.summary}`)
                .join('; ');
            throw new Error(`Compliance violation detected. Cannot accept offer. ${blockers}`);
        }

        // 4–7. Atomically: move swap → MANAGER_PENDING, select offer, reject others, lock both shifts.
        // sm_accept_trade uses FOR UPDATE to prevent double-acceptance races.
        const { data: rpcResult, error: rpcError } = await db.rpc('sm_accept_trade', {
            p_swap_id:              swapId,
            p_offer_id:             offerId,
            p_offerer_id:           offererId,
            p_offer_shift_id:       offerV8ShiftId ?? null,
            p_compliance_snapshot:  complianceSnapshot as any,
        });

        if (rpcError) throw rpcError;
        if (rpcResult && !rpcResult.success) {
            throw new Error(rpcResult.error ?? 'Failed to accept trade');
        }

    },

    /**
     * Reject a trade offer (Requester rejects an offer).
     */
    async rejectTrade(offerId: string): Promise<void> {
        console.log('[API] Rejecting trade offer:', offerId);

        const { error } = await db
            .from('swap_offers')
            .update({ status: 'REJECTED' })
            .eq('id', offerId);

        if (error) throw error;
    }
};

// Helper to map DB columns to Frontend Model
function mapDbToSwapRequest(row: any): SwapRequestWithDetails {
    const originalShift = mapDbShift(row.requester_shift);
    const requestedShift = mapDbShift(row.target_shift);
    const requestorEmployee = mapDbEmployee(row.requested_by);
    const targetEmployee = mapDbEmployee(row.swap_with);

    return {
        id: row.id,
        // Map DB columns to Frontend Model Properties (CamelCase)
        original_shift_id: row.requester_shift_id,
        requested_by_employee_id: row.requester_id,
        swap_with_employee_id: row.target_id,
        offered_shift_id: row.target_shift_id,
        // Metadata
        status: row.status,
        swap_type: row.swap_type,
        reason: row.reason,
        created_at: row.created_at,
        updated_at: row.updated_at,

        // Relations (CamelCase)
        originalShift,
        requestedShift,
        requestorEmployee,
        targetEmployee,
        swap_offers: (row.swap_offers || []).map((offer: any) => ({
            ...offer,
            offered_shift: mapDbShift(offer.offered_shift),
            offerer: mapDbEmployee(offer.offerer)
        })),

        // Legacy / Compatibility Names (snake_case)
        requester_shift: originalShift,
        target_shift: requestedShift,
        requested_by: requestorEmployee,
        swap_with: targetEmployee,

        // Back-compat / Required by ShiftSwap interface
        requester_shift_id: row.requester_shift_id,
        requester_id: row.requester_id,
        target_id: row.target_id,
        target_shift_id: row.target_shift_id,

        // Metadata
        managerApprovedAt: row.updated_at,
        createdAt: row.created_at,
    } as any; // Cast to any to satisfy multiple conflicting interfaces
}

function mapDbShift(shift: any): any {
    if (!shift) return undefined;

    // Map snake_case to CamelCase, including nested relations
    return {
        ...shift, // Spread raw data to keep ID and others if needed
        id: shift.id,
        organizationId: shift.organization_id,
        departmentId: shift.department_id,
        subDepartmentId: shift.sub_department_id,
        shiftDate: shift.shift_date,
        startTime: shift.start_time,
        endTime: shift.end_time,
        roleId: shift.role_id,
        netLength: shift.net_length_minutes,
        lifecycleStatus: shift.lifecycle_status,
        stateId: undefined,

        // Relations explicitly requested in SwapRequestWithDetails
        roles: shift.roles,
        departments: shift.departments,
        sub_departments: shift.sub_departments,
        organizations: shift.organizations,
        tz_identifier: shift.tz_identifier // Keep raw for utils if needed
    };
}

function mapDbEmployee(profile: any): any {
    if (!profile) return undefined;

    return {
        ...profile,
        id: profile.id,
        firstName: profile.first_name,
        lastName: profile.last_name,
        fullName: profile.first_name && profile.last_name
            ? `${profile.first_name} ${profile.last_name}`.trim()
            : (profile.full_name || profile.email),
        avatarUrl: profile.avatar_url,
        email: profile.email
    };
}


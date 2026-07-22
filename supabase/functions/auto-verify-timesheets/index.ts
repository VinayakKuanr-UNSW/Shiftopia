// =============================================================================
// auto-verify-timesheets — Supabase Edge Function (Deno, service role)
//
// The WORKER that drains the timesheet auto-verify queue. For each due shift it
// computes a zero-variance decision (variance.ts) and hands it to the RPC
// `sm_timesheet_auto_decide`, which OWNS the commit (idempotency dedup, shadow
// suppression, kill-switch, the gated timesheets approve write, and all
// timesheet_decisions / timesheet_audit_log rows). The worker never writes
// timesheets directly.
//
// Mirrors auto-approve-swaps: SELF-CONTAINED (supabase-js only), claims via
// sm_timesheet_queue_claim (SKIP LOCKED), settles via sm_timesheet_queue_complete
// (exp-backoff + DLQ). Invocation auth = shared WORKER_SECRET or service role.
//
// ⚠️ DEPLOYMENT STATUS: NOT DEPLOYED. See README.md. Deploy + cron only once the
//    migration 20260722100000_timesheet_auto_verify_shadow.sql is applied and a
//    shadow policy row exists for at least one org.
// =============================================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { evaluateTimesheet, type TimesheetEvalInput } from './variance.ts';

const ENGINE_VERSION = 'auto-verify-timesheets@1.0.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const WORKER_SECRET = Deno.env.get('WORKER_SECRET');
const BATCH_SIZE = Number(Deno.env.get('TIMESHEET_WORKER_BATCH_SIZE') ?? '10') || 10;

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Worker-Secret',
};

interface WorkerSummary {
    claimed: number;
    committed: number;
    shadow: number;
    manual_review: number;
    done: number;
    retried: number;
    errors: number;
}

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function isAuthorizedInvocation(req: Request): boolean {
    const secret = req.headers.get('X-Worker-Secret');
    if (WORKER_SECRET && secret && secret === WORKER_SECRET) return true;
    const auth = req.headers.get('Authorization') ?? '';
    // service-role bearer (cron posts apikey=anon + Authorization: Bearer <service>)
    if (SERVICE_ROLE_KEY && auth === `Bearer ${SERVICE_ROLE_KEY}`) return true;
    return false;
}

interface QueueRow {
    id: string;
    shift_id: string;
    idempotency_key: string;
    attempts: number;
    max_attempts: number;
}

const toMs = (v: string | null | undefined): number | null => {
    if (!v) return null;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
};

Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
        return json(500, { error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY', code: 'CONFIG' });
    }
    if (!isAuthorizedInvocation(req)) return json(401, { error: 'UNAUTHORIZED', code: 'UNAUTHORIZED' });

    const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const workerId = `timesheet-worker:${crypto.randomUUID()}`;
    const summary: WorkerSummary = { claimed: 0, committed: 0, shadow: 0, manual_review: 0, done: 0, retried: 0, errors: 0 };

    try {
        const { data: claimedData, error: claimErr } = await service.rpc('sm_timesheet_queue_claim', {
            p_worker: workerId,
            p_limit: BATCH_SIZE,
        });
        if (claimErr) return json(500, { error: `claim failed: ${claimErr.message}`, code: 'CLAIM_FAILED' });

        const claimed = (claimedData ?? []) as QueueRow[];
        summary.claimed = claimed.length;

        for (const row of claimed) {
            await processRow(service, row, summary);
        }
        return json(200, summary);
    } catch (e) {
        console.error('[auto-verify-timesheets] unhandled', e);
        return json(500, { error: String(e), code: 'INTERNAL' });
    }
});

async function complete(service: SupabaseClient, id: string, status: 'DONE' | 'RETRY', error?: string): Promise<void> {
    // RETRY is expressed to the RPC as a non-DONE status; it applies backoff/DLQ.
    await service.rpc('sm_timesheet_queue_complete', {
        p_id: id,
        p_status: status === 'DONE' ? 'DONE' : 'RETRY',
        p_error: error ?? null,
    });
}

async function processRow(service: SupabaseClient, row: QueueRow, summary: WorkerSummary): Promise<void> {
    try {
        // ── Load the shift (scheduled + actual instants, org/dept, employee). ──
        const { data: shift, error: shiftErr } = await service
            .from('shifts')
            .select('id, organization_id, department_id, assigned_employee_id, shift_date, start_at, end_at, actual_start, actual_end, attendance_status, lifecycle_status')
            .eq('id', row.shift_id)
            .maybeSingle();
        if (shiftErr) throw shiftErr;
        if (!shift) {
            await complete(service, row.id, 'DONE', 'shift gone');
            summary.done++;
            return;
        }

        // ── Resolve policy (dept beats org); none/disabled ⇒ DONE (RPC re-guards). ──
        const policy = await resolvePolicy(service, shift.organization_id, shift.department_id);
        if (!policy || !policy.enabled) {
            await complete(service, row.id, 'DONE', 'no enabled policy');
            summary.done++;
            return;
        }

        // ── Load the timesheet overlay (manual edits + current status). ──
        const { data: timesheet } = await service
            .from('timesheets')
            .select('id, status, start_time, end_time')
            .eq('shift_id', row.shift_id)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        // ── Compute the zero-variance decision (pure). ──
        const input: TimesheetEvalInput = {
            toleranceMinutes: policy.tolerance_minutes ?? 5,
            requireNoOvertime: policy.require_no_overtime ?? true,
            attendanceStatus: shift.attendance_status ?? null,
            timesheetStatus: timesheet?.status ?? null,
            hasManualEdit: !!(timesheet?.start_time || timesheet?.end_time),
            scheduledStartMs: toMs(shift.start_at),
            scheduledEndMs: toMs(shift.end_at),
            actualStartMs: toMs(shift.actual_start),
            actualEndMs: toMs(shift.actual_end),
        };
        const evalResult = evaluateTimesheet(input);

        if (evalResult.alreadyFinal) {
            await complete(service, row.id, 'DONE', evalResult.reason);
            summary.done++;
            return;
        }

        const subtitle = await buildSubtitle(service, shift.assigned_employee_id, shift.shift_date, evalResult.varianceInMin, evalResult.varianceOutMin);

        // ── Hand the decision to the commit gateway. ──
        const { data: decideData, error: decideErr } = await service.rpc('sm_timesheet_auto_decide', {
            p_shift_id: row.shift_id,
            p_idempotency_key: row.idempotency_key,
            p_payload: {
                decision: evalResult.decision,
                reason: evalResult.reason,
                subtitle,
                engine_version: ENGINE_VERSION,
                policy_version: policy.version,
                detail: { attendance_status: shift.attendance_status },
                variance_snapshot: {
                    variance_in_min: evalResult.varianceInMin,
                    variance_out_min: evalResult.varianceOutMin,
                    tolerance_minutes: input.toleranceMinutes,
                },
            },
        });
        if (decideErr) throw decideErr;

        const code = (decideData as { code?: string })?.code ?? 'UNKNOWN';
        if (code === 'COMMITTED') summary.committed++;
        else if (code === 'SHADOW') summary.shadow++;
        else if (code === 'MANUAL_REVIEW') summary.manual_review++;

        await complete(service, row.id, 'DONE', code);
        summary.done++;
    } catch (e) {
        summary.errors++;
        summary.retried++;
        console.error('[auto-verify-timesheets] row failed', row.shift_id, e);
        await complete(service, row.id, 'RETRY', String(e));
    }
}

interface TimesheetPolicy {
    enabled: boolean;
    shadow_mode: boolean;
    version: number;
    tolerance_minutes: number;
    require_no_overtime: boolean;
}

async function resolvePolicy(service: SupabaseClient, orgId: string | null, deptId: string | null): Promise<TimesheetPolicy | null> {
    if (!orgId) return null;
    const { data } = await service
        .from('timesheet_approval_rules')
        .select('enabled, shadow_mode, version, tolerance_minutes, require_no_overtime, department_id')
        .eq('organization_id', orgId)
        .or(`department_id.eq.${deptId ?? '00000000-0000-0000-0000-000000000000'},department_id.is.null`)
        .order('department_id', { ascending: false, nullsFirst: false })
        .limit(1);
    const row = (data ?? [])[0] as (TimesheetPolicy & { department_id: string | null }) | undefined;
    return row ?? null;
}

async function buildSubtitle(
    service: SupabaseClient,
    employeeId: string | null,
    workDate: string | null,
    varIn: number | null,
    varOut: number | null,
): Promise<string> {
    let name = '';
    if (employeeId) {
        const { data } = await service.from('profiles').select('first_name, last_name').eq('id', employeeId).maybeSingle();
        if (data) name = [data.first_name, data.last_name].filter(Boolean).join(' ');
    }
    const varPart = varIn != null && varOut != null
        ? `in ${varIn >= 0 ? '+' : ''}${varIn}m / out ${varOut >= 0 ? '+' : ''}${varOut}m`
        : '';
    return [name || 'Employee', workDate, varPart].filter(Boolean).join(' · ');
}

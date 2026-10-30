/**
 * Tests for validateCompliance using direct PostgreSQL eba_check_assignment RPC
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    rpc: (async () => ({ data: null, error: null })) as (...a: any[]) => Promise<any>,
    invoke: (async () => ({ data: null, error: null })) as (...a: any[]) => Promise<any>,
}));

vi.mock('@/platform/supabase/client', () => ({
    supabase: {
        rpc: (...a: any[]) => h.rpc(...a),
        functions: { invoke: (...a: any[]) => h.invoke(...a) },
    },
}));

import { validateCompliance, complianceService, mapEbaRowsToComplianceResult } from '../compliance.service';

const EMP = '11111111-1111-4111-8111-111111111111';
const FUTURE = '2099-11-20';

describe('validateCompliance — direct database eba_check_assignment RPC', () => {
    beforeEach(() => {
        h.rpc = async () => ({ data: null, error: null });
        h.invoke = async () => ({ data: null, error: null });
    });

    it('maps compliant return row to passed status', async () => {
        h.rpc = async (fn: string, args: any) => {
            expect(fn).toBe('eba_check_assignment');
            expect(args.p_employee_id).toBe(EMP);
            return {
                data: [
                    {
                        is_compliant: true,
                        rule_id: null,
                        rule_name: null,
                        tier: null,
                        summary: 'Compliant',
                        details: 'Shift assignment complies with EBA rules.',
                        payload: {},
                    },
                ],
                error: null,
            };
        };

        const res = await validateCompliance({
            employeeId: EMP,
            shiftDate: FUTURE,
            startTime: '09:00:00',
            endTime: '17:00:00',
            netLengthMinutes: 450,
            unpaidBreakMinutes: 30,
        });

        expect(res.status).toBe('passed');
        expect(res.violations).toHaveLength(0);
        expect(res.warnings).toHaveLength(0);
        expect(res.checksPerformed).toContain('eba_check_assignment');
    });

    it('maps BLOCKING row to violated status with violation details', async () => {
        h.rpc = async () => ({
            data: [
                {
                    is_compliant: false,
                    rule_id: 'V8_MAX_DAILY_HOURS',
                    rule_name: 'Maximum Daily Hours',
                    tier: 'BLOCKING',
                    summary: 'Exceeds maximum daily work hours',
                    details: 'Shift would result in 13.0h of work in a single day (maximum is 12.0h).',
                    payload: { daily_hours: 13.0, limit: 12.0 },
                },
            ],
            error: null,
        });

        const res = await validateCompliance({
            employeeId: EMP,
            shiftDate: FUTURE,
            startTime: '08:00:00',
            endTime: '22:00:00',
            netLengthMinutes: 780,
        });

        expect(res.status).toBe('violated');
        expect(res.violations).toHaveLength(1);
        expect(res.violations[0]).toContain('13.0h of work in a single day');
    });

    it('maps WARNING row to warned status when no blocking violations exist', async () => {
        h.rpc = async () => ({
            data: [
                {
                    is_compliant: true,
                    rule_id: 'V8_MEAL_BREAK_TIMING',
                    rule_name: 'Meal Break Timing',
                    tier: 'WARNING',
                    summary: 'Meal break placed after 5 hours of work',
                    details: 'Meal break scheduled after 5.5h of work (ICC EBA cl. 36.2 recommending break no later than 5h).',
                    payload: {},
                },
            ],
            error: null,
        });

        const res = await validateCompliance({
            employeeId: EMP,
            shiftDate: FUTURE,
            startTime: '09:00:00',
            endTime: '17:00:00',
            netLengthMinutes: 450,
        });

        expect(res.status).toBe('warned');
        expect(res.violations).toHaveLength(0);
        expect(res.warnings).toHaveLength(1);
        expect(res.warnings[0]).toContain('Meal break scheduled after 5.5h');
    });

    it('extracts qualification violations correctly', () => {
        const res = mapEbaRowsToComplianceResult([
            {
                is_compliant: false,
                rule_id: 'V8_QUALIFICATIONS',
                rule_name: 'Qualifications',
                tier: 'BLOCKING',
                summary: 'Missing required skill',
                details: 'Required skill "First Aid Level 2" not held by employee.',
                payload: { skill_id: 'sk-1', skill_name: 'First Aid Level 2' },
            },
        ]);

        expect(res.status).toBe('violated');
        expect(res.qualificationViolations).toHaveLength(1);
        expect(res.qualificationViolations[0].type).toBe('SKILL_MISSING');
        expect(res.qualificationViolations[0].skill_name).toBe('First Aid Level 2');
    });

    it('works with legacy validateShiftCompliance adapter and returns engineReached true', async () => {
        h.rpc = async () => ({
            data: [
                {
                    is_compliant: true,
                    rule_id: null,
                    rule_name: null,
                    tier: null,
                    summary: 'Compliant',
                    details: 'Shift assignment complies with EBA rules.',
                    payload: {},
                },
            ],
            error: null,
        });

        const res = await complianceService.validateShiftCompliance(EMP, FUTURE, '09:00:00', '17:00:00', 450);
        expect(res.isValid).toBe(true);
        expect(res.engineReached).toBe(true);
        expect(res.status).toBe('passed');
    });
});

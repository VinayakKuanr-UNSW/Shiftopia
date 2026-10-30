import { supabase } from '@/platform/supabase/client';
import type { DemandRuleRow } from '../domain/ruleEngine.types';

/**
 * Demand Engine L3 — demand_rules queries.
 * Table: public.demand_rules (migration 20260502000012).
 */
export const demandRulesQueries = {
    /**
     * All active rules, sorted by priority asc, then rule_code asc.
     * Lower priority numbers fire first. The executor expects a stable order
     * for deterministic explanation arrays.
     */
    async listActive(): Promise<DemandRuleRow[]> {
        const { data, error } = await supabase
            .from('demand_rules')
            .select('*')
            .eq('is_active', true)
            .order('priority', { ascending: true })
            .order('rule_code', { ascending: true });
        if (error) throw new Error(`demandRules.listActive failed: ${error.message}`);
        return (data ?? []) as DemandRuleRow[];
    },
};

-- Performance-advisor findings on hr.contract_pay_terms (added in contract_pay_basis):
--   • unindexed_foreign_keys       — contract_pay_terms_remuneration_level_fkey
--   • multiple_permissive_policies — two SELECT policies for authenticated
-- One SELECT policy with the same two conditions OR-ed together; same access.

CREATE INDEX contract_pay_terms_remuneration_level_idx
    ON hr.contract_pay_terms (remuneration_level);

DROP POLICY contract_pay_terms_select_own   ON hr.contract_pay_terms;
DROP POLICY contract_pay_terms_select_delta ON hr.contract_pay_terms;

-- Own contract's history, or everything for delta-access managers — the same
-- two conditions as hr.user_contracts' contracts_select_own / _delta.
CREATE POLICY contract_pay_terms_select ON hr.contract_pay_terms
    FOR SELECT TO authenticated
    USING (
        public.user_has_delta_access((SELECT auth.uid()))
        OR EXISTS (
            SELECT 1 FROM hr.user_contracts c
             WHERE c.id = contract_pay_terms.contract_id
               AND c.user_id = (SELECT auth.uid()))
    );

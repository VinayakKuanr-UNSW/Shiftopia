/**
 * The rate-card admin screen's calls, over the real API (Settings › Pay Rates ›
 * Versions; src/modules/payroll/data/rateCards.api.ts). The SQL harness
 * (rate-cards.int.test.ts) proves the rules inside the database; this proves
 * them the way the browser reaches them — PostgREST, GRANTs, signed JWTs — and
 * that the screen's select (imported, not copied) names only real columns
 * (PostgREST reads one bad name as an error, which the screen would show as
 * "could not be read").
 *
 * Publishing is permanent, so the cards made here are removed afterwards and
 * ICC Sydney's open-ended card is reopened, leaving the stack as the seed left it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { personaClient, stack } from '../support/clients';
import { psql, resetFixtures } from '../support/stack';
import { RATE_CARD_SELECT } from '../../../src/modules/payroll/data/rateCards.select';
const ORG = '00000000-0000-0000-0000-000000000001';
const PREFIX = 'HTTP-ADMIN-';

// Removing a published card is exactly what the published-card lock refuses,
// so clean-up opens it for this session (pay.rate_card_lock).
const cleanUp = () => psql(stack().dbContainer, `
    SET pay.rate_card_lock = 'off';
    DELETE FROM public.eba_rate WHERE rate_card_id IN (SELECT id FROM public.pay_rate_cards WHERE code LIKE '${PREFIX}%');
    DELETE FROM public.eba_allowance WHERE rate_card_id IN (SELECT id FROM public.pay_rate_cards WHERE code LIKE '${PREFIX}%');
    DELETE FROM public.eba_trainee_schedule WHERE rate_card_id IN (SELECT id FROM public.pay_rate_cards WHERE code LIKE '${PREFIX}%');
    DELETE FROM public.pay_rate_card_loadings WHERE rate_card_id IN (SELECT id FROM public.pay_rate_cards WHERE code LIKE '${PREFIX}%');
    DELETE FROM public.pay_rate_cards WHERE code LIKE '${PREFIX}%';
    UPDATE public.pay_rate_cards SET valid_to = NULL WHERE code = 'ICC-EA-2026-27';
`);

const cards = async (p: 'E' | 'F' | 'Z') => {
    const { data, error } = await personaClient(p).from('pay_rate_cards').select(RATE_CARD_SELECT)
        .eq('organization_id', ORG).order('valid_from', { ascending: true });
    expect(error).toBeNull();
    return data as any[];
};

let source: any;

beforeAll(async () => {
    resetFixtures(stack().dbContainer);
    cleanUp();
    source = (await cards('Z')).find((c) => c.code === 'ICC-EA-2026-27');
});
afterAll(() => { cleanUp(); });

describe('rate-card admin over HTTP', () => {
    it('the screen\'s select reads every member\'s published cards with their lines', async () => {
        expect(source).toBeDefined();
        expect(source.status).toBe('published');
        expect(source.eba_rate.length).toBeGreaterThan(0);
        expect(source.eba_allowance.length).toBeGreaterThan(0);
        // One-to-one embed: an object, not an array (rateCards.api maps either).
        expect(Number(source.pay_rate_card_loadings?.saturday_loading)).toBe(0.25);
        expect((await cards('E')).map((c) => c.code)).toEqual(['ICC-EA-2025', 'ICC-EA-2026-27']);
        expect(await cards('F')).toEqual([]); // another organization's member
    });

    it('epsilon (view-only) cannot roll a card forward', async () => {
        const { error } = await personaClient('E').rpc('roll_rate_card_forward', {
            p_source_card_id: source.id, p_code: `${PREFIX}E`, p_name: 'x', p_valid_from: '2031-07-07', p_multiplier: 1.03,
        });
        expect(error?.code).toBe('42501');
    });

    it('zeta rolls forward, the draft is hidden from epsilon, zeta publishes it', async () => {
        const z = personaClient('Z');
        const roll = await z.rpc('roll_rate_card_forward', {
            p_source_card_id: source.id, p_code: `${PREFIX}2031`, p_name: 'HTTP admin 2031', p_valid_from: '2031-07-07', p_multiplier: 1.042,
        });
        expect(roll.error).toBeNull();
        const draftId = roll.data as string;

        const draft = (await cards('Z')).find((c) => c.id === draftId);
        expect(draft).toMatchObject({ status: 'draft', valid_to: null, derivation: 'ICC-EA-2026-27 × 1.042' });
        expect(draft.eba_rate).toHaveLength(source.eba_rate.length);
        expect(draft.pay_rate_card_loadings).toEqual(source.pay_rate_card_loadings); // rolled forward unchanged
        const level = source.eba_rate[0];
        const scaled = draft.eba_rate.find((r: any) =>
            r.classification === level.classification && r.employment_basis === level.employment_basis);
        expect(Number(scaled.paid_hourly_rate)).toBe(Math.round(Number(level.paid_hourly_rate) * 1.042 * 100) / 100);
        expect((await cards('E')).some((c) => c.id === draftId)).toBe(false);

        // Epsilon can neither publish nor discard it.
        expect((await personaClient('E').rpc('publish_rate_card', { p_card_id: draftId })).error?.code).toBe('42501');
        expect((await personaClient('E').rpc('discard_rate_card', { p_card_id: draftId })).error?.code).toBe('42501');

        expect((await z.rpc('publish_rate_card', { p_card_id: draftId })).error).toBeNull();
        const after = await cards('E');
        expect(after.find((c) => c.id === draftId)?.status).toBe('published');
        expect(after.find((c) => c.code === 'ICC-EA-2026-27')?.valid_to).toBe('2031-07-06');

        // Published: no discarding it now.
        expect((await z.rpc('discard_rate_card', { p_card_id: draftId })).error?.code).toBe('55000');
    });

    it('zeta discards a draft, and a duplicate code is refused', async () => {
        const z = personaClient('Z');
        const roll = await z.rpc('roll_rate_card_forward', {
            p_source_card_id: source.id, p_code: `${PREFIX}DISCARD`, p_name: 'to discard', p_valid_from: '2030-07-01', p_multiplier: 1.01,
        });
        expect(roll.error).toBeNull();
        const dup = await z.rpc('roll_rate_card_forward', {
            p_source_card_id: source.id, p_code: `${PREFIX}DISCARD`, p_name: 'again', p_valid_from: '2030-07-01', p_multiplier: 1.01,
        });
        expect(dup.error?.code).toBe('23505');

        expect((await z.rpc('discard_rate_card', { p_card_id: roll.data })).error).toBeNull();
        expect((await cards('Z')).some((c) => c.id === roll.data)).toBe(false);
    });
});

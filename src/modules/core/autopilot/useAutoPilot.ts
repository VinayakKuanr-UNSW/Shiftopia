import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/modules/core/hooks/use-toast';
import {
    type AutoPilotAdapter,
    type AutoPilotDecision,
    type AutoPilotPolicy,
} from './types';

/**
 * A mutable copy of the policy the popover edits. Kept flat: `enabled` plus
 * every declared field key.
 */
export interface AutoPilotDraft {
    enabled: boolean;
    fields: Record<string, number | boolean>;
}

const draftFromPolicy = (
    adapter: AutoPilotAdapter,
    p: AutoPilotPolicy | null,
): AutoPilotDraft => {
    const fields: Record<string, number | boolean> = {};
    for (const f of adapter.policyFields) {
        const fallback = f.default ?? (f.type === 'toggle' ? false : (f.min ?? 0));
        fields[f.key] = p?.fields?.[f.key] ?? fallback;
    }
    return {
        enabled: p?.enabled ?? false,
        fields,
    };
};

const draftToPolicy = (draft: AutoPilotDraft, base: AutoPilotPolicy | null): AutoPilotPolicy => ({
    enabled: draft.enabled,
    version: base?.version ?? 0,
    fields: { ...draft.fields },
});

/**
 * Owns all AutoPilot state for one adapter: the saved policy, an editable draft,
 * the recent-decision feed, and the save/revert/refresh actions. The
 * `<AutoPilotControl>` is a thin render over this.
 */
export function useAutoPilot(adapter: AutoPilotAdapter, open: boolean) {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [revertingId, setRevertingId] = useState<string | null>(null);
    const [policy, setPolicy] = useState<AutoPilotPolicy | null>(null);
    const [draft, setDraft] = useState<AutoPilotDraft>(() => draftFromPolicy(adapter, null));
    const [decisions, setDecisions] = useState<AutoPilotDecision[]>([]);

    const isDirty = useMemo(() => {
        const base = draftFromPolicy(adapter, policy);
        if (draft.enabled !== base.enabled) return true;
        return adapter.policyFields.some(f => draft.fields[f.key] !== base.fields[f.key]);
    }, [adapter, draft, policy]);

    /** Cheap badge fetch on mount (one row); the full feed loads when opened. */
    useEffect(() => {
        let cancelled = false;
        adapter
            .getPolicy()
            .then(p => {
                if (cancelled) return;
                setPolicy(p);
                setDraft(draftFromPolicy(adapter, p));
            })
            .catch(() => {
                /* badge stays OFF; the popover load surfaces the error */
            });
        return () => {
            cancelled = true;
        };
    }, [adapter]);

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            // Timesheets embed decisions in each shift's history, so skip the feed.
            const wantFeed = adapter.showDecisionFeed !== false;
            const [p, feed] = await Promise.all([
                adapter.getPolicy(),
                wantFeed ? adapter.getRecentDecisions(20) : Promise.resolve([]),
            ]);
            setPolicy(p);
            setDraft(draftFromPolicy(adapter, p));
            setDecisions(feed);
        } catch (error) {
            console.error('[AutoPilot] load failed:', error);
            toast({
                title: `${adapter.copy.buttonLabel} unavailable`,
                description: error instanceof Error ? error.message : 'Failed to load the policy.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }, [adapter, toast]);

    useEffect(() => {
        if (open) load();
    }, [open, load]);

    const save = useCallback(async () => {
        setIsSaving(true);
        try {
            const saved = await adapter.savePolicy(draftToPolicy(draft, policy));
            setPolicy(saved);
            setDraft(draftFromPolicy(adapter, saved));
            toast({ title: `${adapter.copy.buttonLabel} policy saved` });
            return true;
        } catch (error: any) {
            console.error('[AutoPilot] save failed:', error);
            const isMissingTable = error && (
                error.code === '42P01' ||
                error.status === 404 ||
                (typeof error.code === 'string' && error.code.startsWith('PGRST')) ||
                (typeof error.message === 'string' && (
                    error.message.includes('does not exist') ||
                    error.message.includes('not found') ||
                    error.message.includes('Could not find') ||
                    error.message.includes('schema cache')
                ))
            );
            toast({
                title: isMissingTable ? 'Database Table Not Provisioned' : 'Save failed',
                description: isMissingTable
                    ? 'The database table for this feature is not provisioned on Supabase yet. Run DB migration to enable.'
                    : error instanceof Error ? error.message : 'Could not save the policy.',
                variant: 'destructive',
            });
            return false;
        } finally {
            setIsSaving(false);
        }
    }, [adapter, draft, policy, toast]);

    const revert = useCallback(
        async (decision: AutoPilotDecision, onReverted?: () => void) => {
            if (!adapter.revert) return;
            setRevertingId(decision.id);
            try {
                await adapter.revert(decision);
                toast({ title: 'Auto-decision undone' });
                await load();
                onReverted?.();
            } catch (error) {
                console.error('[AutoPilot] revert failed:', error);
                toast({
                    title: 'Undo failed',
                    description: error instanceof Error ? error.message : 'Could not revert the decision.',
                    variant: 'destructive',
                });
            } finally {
                setRevertingId(null);
            }
        },
        [adapter, load, toast],
    );

    return {
        isLoading,
        isSaving,
        revertingId,
        policy,
        draft,
        setDraft,
        decisions,
        isDirty,
        load,
        save,
        revert,
    };
}

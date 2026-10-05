/**
 * Why a shift created from the Office grid did not appear until a hard refresh.
 *
 * The modal fired the create and closed immediately. The Office page unmounts
 * the modal on close, and TanStack Query DROPS per-call `mutate(vars, { onSuccess })`
 * callbacks once the component that issued them unmounts. The page's refetch
 * lived in that callback, so it never ran.
 *
 * The first block reproduces the library behaviour itself, so the reason is
 * pinned rather than remembered. The second pins the orchestrator to the form
 * that survives (`mutateAsync().then`), with comments stripped first — a
 * source-reading test in this repo once passed against the comment describing
 * the bug.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';

function deferred() {
    let resolveFn!: () => void;
    const promise = new Promise<void>(r => { resolveFn = r; });
    return { promise, resolve: resolveFn };
}

/** Fires the mutation on mount, the way the modal does just before it closes. */
function Firer({ style, onSuccess, gate }: {
    style: 'mutate-callback' | 'mutateAsync-then';
    onSuccess: () => void;
    gate: Promise<void>;
}) {
    const m = useMutation({ mutationFn: () => gate });
    React.useEffect(() => {
        if (style === 'mutate-callback') m.mutate(undefined, { onSuccess });
        else void m.mutateAsync(undefined).then(onSuccess);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
}

async function runAndUnmount(style: 'mutate-callback' | 'mutateAsync-then') {
    const qc = new QueryClient();
    const gate = deferred();
    const onSuccess = vi.fn();
    const view = render(
        <QueryClientProvider client={qc}>
            <Firer style={style} onSuccess={onSuccess} gate={gate.promise} />
        </QueryClientProvider>,
    );
    view.unmount();                 // the modal closes before the server answers
    await act(async () => { gate.resolve(); await gate.promise; await Promise.resolve(); });
    return onSuccess;
}

describe('the library behaviour behind the bug', () => {
    it('drops a per-call mutate callback when the caller unmounts first', async () => {
        expect(await runAndUnmount('mutate-callback')).not.toHaveBeenCalled();
    });

    it('still runs mutateAsync().then after the caller unmounts', async () => {
        expect(await runAndUnmount('mutateAsync-then')).toHaveBeenCalledTimes(1);
    });
});

describe('the modal uses the form that survives', () => {
    const src = readFileSync(resolve(process.cwd(),
        'src/modules/rosters/ui/dialogs/EnhancedAddShiftModal/hooks/useShiftFormOrchestrator.ts'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

    it('reports a create through mutateAsync().then, not a mutate callback', () => {
        expect(src).toMatch(/createShiftMutation\.mutateAsync\(payload\)\s*\.then\(\(\) => onSuccess\?\.\(\)\)/);
        expect(src).not.toMatch(/createShiftMutation\.mutate\(\s*payload\s*,\s*\{\s*onSuccess/);
    });
});

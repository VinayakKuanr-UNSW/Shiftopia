/**
 * Minimal Supabase query-builder mock for unit-testing timesheets.supabase.api.
 * Same FIFO-queue strategy as planning/unified/__tests__/helpers/supabase-mock.ts
 * (queue responses in exact call order), extended with `.maybeSingle()`.
 */

import { vi } from 'vitest';

export type MockResult = { data?: unknown; error?: { message: string } | null };

export function createSupabaseMock() {
  const queue: MockResult[] = [];

  function dequeue(): MockResult {
    const next = queue.shift();
    if (!next) {
      console.warn('[supabase-mock] queue empty — returning { data: null, error: null }');
      return { data: null, error: null };
    }
    return next;
  }

  function makeChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      in: () => chain,
      insert: () => chain,
      update: () => chain,
      upsert: () => chain,
      delete: () => chain,
      filter: () => chain,
      order: () => chain,
      limit: () => chain,
      range: () => chain,
      single: () => Promise.resolve(dequeue()),
      maybeSingle: () => Promise.resolve(dequeue()),
      then: (resolve: (v: MockResult) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(dequeue()).then(resolve as (v: MockResult) => MockResult, reject),
    };
    return chain;
  }

  const client = {
    from: vi.fn().mockImplementation(() => makeChain()),
  };

  return {
    client,
    enqueue: (...items: MockResult[]) => queue.push(...items),
  };
}

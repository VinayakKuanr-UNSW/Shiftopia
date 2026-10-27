// @vitest-environment node
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { build, type Rollup } from 'vite';
import { ProjectionWorkerPool } from '../projection.worker.pool';
import type { ProjectionRequest } from '../protocol';

const POOL_PATH = path.resolve(__dirname, '../projection.worker.pool.ts');

describe('ProjectionWorkerPool production bundle', () => {
  // The dev server transpiles any .ts URL on request, so only a real build
  // shows whether Vite recognised the worker. When it doesn't, it inlines the
  // raw TypeScript as `data:video/mp2t` and every worker-powered view is empty.
  it('bundles projection.worker.ts as a compiled worker chunk', async () => {
    const out = (await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { '@': path.resolve(__dirname, '../../../../../..') } },
      build: {
        write: false,
        minify: false,
        rollupOptions: { input: POOL_PATH, preserveEntrySignatures: 'exports-only' },
      },
    })) as Rollup.RollupOutput;

    const files = out.output.map((o) => o.fileName);
    const poolChunk = out.output.find(
      (o): o is Rollup.OutputChunk => o.type === 'chunk' && o.fileName.includes('projection.worker.pool'),
    );

    expect(files.some((f) => /assets\/projection\.worker-[\w-]+\.js$/.test(f))).toBe(true);
    expect(poolChunk?.code).not.toContain('data:video/mp2t');
  }, 60_000);
});

describe('ProjectionWorkerPool worker failure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('fails the in-flight request once when the workers cannot load', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const workers: Array<{ onerror: ((e: { message: string }) => void) | null }> = [];
    vi.stubGlobal(
      'Worker',
      class {
        onmessage = null;
        onerror: ((e: { message: string }) => void) | null = null;
        constructor() {
          workers.push(this);
        }
        postMessage() {}
        terminate() {}
      },
    );

    const pool = new ProjectionWorkerPool({ poolSize: 2, debounceMs: 0 });
    const onError = vi.fn();
    pool.onError = onError;

    const requestId = pool.requestProjection({
      mode: 'people',
      shifts: [],
    } as unknown as Omit<ProjectionRequest, 'requestId'>);
    vi.runAllTimers();

    for (const w of workers) w.onerror?.({ message: '' });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ requestId }));
  });
});

/**
 * Performance tracking module
 *
 * Provides:
 *   - QueryPerfTracker — subscribes to the TanStack Query cache and logs
 *     per-query timing (start → settled), classifying as fast / moderate / slow
 *   - WebVitalsCollector — reads CLS, LCP, FID/INP from PerformanceObserver
 *     and stores the most-recent value for display in the dev overlay
 *   - Singleton instances exported for shared use across the app
 *
 * Everything here is import-safe in production; all recording is
 * no-op'd unless explicitly started by the dev overlay.
 */

import type { QueryClient } from '@tanstack/react-query';

// ── Types ─────────────────────────────────────────────────────────────────────

export type QueryPerfStatus = 'loading' | 'success' | 'error';

export interface QueryPerfEntry {
    /** Serialised query key (for display) */
    key:       string;
    /** Wall-clock time from first observation to settled in ms */
    duration:  number;
    status:    QueryPerfStatus;
    timestamp: number;
    /** good < 300 ms | needs-improvement < 800 ms | poor ≥ 800 ms */
    rating:    'good' | 'needs-improvement' | 'poor';
}

export interface WebVitalsSnapshot {
    cls?: number;      // Cumulative Layout Shift     (good < 0.1)
    lcp?: number;      // Largest Contentful Paint ms (good < 2500)
    fid?: number;      // First Input Delay ms        (good < 100)
    inp?: number;      // Interaction to Next Paint ms (good < 200)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rateQuery(ms: number): QueryPerfEntry['rating'] {
    if (ms < 300) return 'good';
    if (ms < 800) return 'needs-improvement';
    return 'poor';
}

function serializeKey(raw: unknown): string {
    try {
        if (Array.isArray(raw)) return raw.join(' › ');
        return String(raw);
    } catch {
        return '(unserializable key)';
    }
}

// ── QueryPerfTracker ──────────────────────────────────────────────────────────

const MAX_ENTRIES = 60;

export class QueryPerfTracker {
    private readonly log: QueryPerfEntry[] = [];
    private readonly pending = new Map<string, number>(); // key → start ts
    private unsubscribe: (() => void) | null = null;
    private listeners: Array<() => void> = [];

    /** Attach to a QueryClient and start recording. */
    start(client: QueryClient): void {
        if (this.unsubscribe) return; // already started

        const cache = client.getQueryCache();

        this.unsubscribe = cache.subscribe(event => {
            const key = serializeKey((event.query as { queryKey?: unknown }).queryKey ?? '?');

            if (event.type === 'updated') {
                const state = event.query.state;

                if (state.fetchStatus === 'fetching' && !this.pending.has(key)) {
                    this.pending.set(key, performance.now());
                }

                if (state.fetchStatus === 'idle' && this.pending.has(key)) {
                    const start    = this.pending.get(key)!;
                    const duration = Math.round(performance.now() - start);
                    this.pending.delete(key);

                    const status: QueryPerfStatus =
                        state.status === 'error' ? 'error' :
                        state.status === 'success' ? 'success' : 'loading';

                    const entry: QueryPerfEntry = {
                        key,
                        duration,
                        status,
                        timestamp: Date.now(),
                        rating:    rateQuery(duration),
                    };

                    this.log.unshift(entry);
                    if (this.log.length > MAX_ENTRIES) this.log.length = MAX_ENTRIES;
                    this.emit();
                }
            }
        });
    }

    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    /** Most-recent N entries, newest first. */
    getRecent(n = 12): QueryPerfEntry[] {
        return this.log.slice(0, n);
    }

    getAverageDuration(): number {
        if (!this.log.length) return 0;
        return Math.round(this.log.reduce((s, e) => s + e.duration, 0) / this.log.length);
    }

    getErrorCount(): number {
        return this.log.filter(e => e.status === 'error').length;
    }

    onUpdate(fn: () => void): () => void {
        this.listeners.push(fn);
        return () => { this.listeners = this.listeners.filter(l => l !== fn); };
    }

    private emit(): void {
        this.listeners.forEach(fn => fn());
    }
}

// ── WebVitalsCollector ────────────────────────────────────────────────────────

export class WebVitalsCollector {
    private snapshot: WebVitalsSnapshot = {};
    private observers: PerformanceObserver[] = [];
    private listeners: Array<() => void> = [];

    start(): void {
        if (!('PerformanceObserver' in window)) return;

        // CLS — sum layout shift scores
        this.observe('layout-shift', (entries) => {
            const existing = this.snapshot.cls ?? 0;
            const added    = (entries as PerformanceEntry[])
                .filter(e => !(e as { hadRecentInput?: boolean }).hadRecentInput)
                .reduce((s, e) => s + ((e as { value?: number }).value ?? 0), 0);
            this.snapshot.cls = Math.round((existing + added) * 1000) / 1000;
            this.emit();
        });

        // LCP
        this.observe('largest-contentful-paint', (entries) => {
            const last = entries[entries.length - 1];
            if (last) {
                this.snapshot.lcp = Math.round(last.startTime);
                this.emit();
            }
        });

        // FID
        this.observe('first-input', (entries) => {
            const e = entries[0] as PerformanceEventTiming | undefined;
            if (e) {
                this.snapshot.fid = Math.round(e.processingStart - e.startTime);
                this.emit();
            }
        });

        // INP (Chrome 96+)
        this.observe('event', (entries) => {
            const worst = (entries as PerformanceEventTiming[])
                .map(e => e.duration)
                .reduce((a, b) => Math.max(a, b), 0);
            if (worst > (this.snapshot.inp ?? 0)) {
                this.snapshot.inp = Math.round(worst);
                this.emit();
            }
        });
    }

    stop(): void {
        this.observers.forEach(o => o.disconnect());
        this.observers = [];
    }

    getSnapshot(): Readonly<WebVitalsSnapshot> {
        return { ...this.snapshot };
    }

    onUpdate(fn: () => void): () => void {
        this.listeners.push(fn);
        return () => { this.listeners = this.listeners.filter(l => l !== fn); };
    }

    private observe(
        type: string,
        cb: (entries: PerformanceEntry[]) => void,
    ): void {
        try {
            const obs = new PerformanceObserver(list => cb(list.getEntries()));
            obs.observe({ type, buffered: true });
            this.observers.push(obs);
        } catch {
            // Entry type not supported in this browser — silently skip
        }
    }

    private emit(): void {
        this.listeners.forEach(fn => fn());
    }
}

// ── Singletons ────────────────────────────────────────────────────────────────

export const queryPerfTracker = new QueryPerfTracker();
export const webVitalsCollector = new WebVitalsCollector();

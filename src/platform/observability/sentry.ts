import * as Sentry from '@sentry/react';

let initialized = false;

export function initSentry(): void {
    if (initialized) return;

    const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
    if (!dsn) {
        // No DSN configured — silently skip. Local dev and CI builds run
        // without Sentry; only environments that set the env var report.
        return;
    }

    const environment =
        (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ??
        (import.meta.env.MODE as string);

    Sentry.init({
        dsn,
        environment,
        release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
        integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration({
                maskAllText: true,
                blockAllMedia: true,
            }),
        ],
        tracesSampleRate: Number(
            import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.1,
        ),
        replaysSessionSampleRate: Number(
            import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE ?? 0,
        ),
        replaysOnErrorSampleRate: Number(
            import.meta.env.VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE ?? 1.0,
        ),
        // Drop noisy / non-actionable browser errors before they reach the network.
        ignoreErrors: [
            'ResizeObserver loop completed with undelivered notifications.',
            'ResizeObserver loop limit exceeded',
            'Non-Error promise rejection captured',
        ],
    });

    initialized = true;
}

export function setSentryUser(user: { id: string; email?: string } | null): void {
    if (!initialized) return;
    Sentry.setUser(user);
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
    if (!initialized) {
        // In dev or unconfigured envs, fall back to console so the error is still visible.
        console.error('[captureException]', error, context);
        return;
    }
    Sentry.captureException(error, context ? { extra: context } : undefined);
}

export function captureMessage(
    message: string,
    level: 'info' | 'warning' | 'error' = 'info',
    context?: Record<string, unknown>,
): void {
    if (!initialized) return;
    Sentry.captureMessage(message, { level, extra: context });
}

/**
 * Structured Logger
 * Provides consistent logging format across the application
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
    module: string;
    operation: string;
    correlationId?: string;
    userId?: string;
    [key: string]: unknown;
}

export interface LogEntry extends LogContext {
    level: LogLevel;
    message: string;
    timestamp: string;
    errorCode?: string;
    stack?: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

// Minimum log level (can be configured via env)
const MIN_LOG_LEVEL: LogLevel =
    (import.meta.env.VITE_LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LOG_LEVEL];
}

function formatLogEntry(entry: LogEntry): string {
    return JSON.stringify(entry);
}

function createLogEntry(
    level: LogLevel,
    message: string,
    context: LogContext,
    error?: Error
): LogEntry {
    return {
        level,
        message,
        timestamp: new Date().toISOString(),
        ...context,
        ...(error && {
            errorCode: error.name,
            stack: error.stack,
        }),
    };
}

export const logger = {
    debug(message: string, context: LogContext): void {
        if (shouldLog('debug')) {
            console.debug(formatLogEntry(createLogEntry('debug', message, context)));
        }
    },

    info(message: string, context: LogContext): void {
        if (shouldLog('info')) {
            console.info(formatLogEntry(createLogEntry('info', message, context)));
        }
    },

    warn(message: string, context: LogContext, error?: Error): void {
        if (shouldLog('warn')) {
            console.warn(formatLogEntry(createLogEntry('warn', message, context, error)));
        }
    },

    error(message: string, context: LogContext, error?: Error): void {
        if (shouldLog('error')) {
            console.error(formatLogEntry(createLogEntry('error', message, context, error)));
        }
        // Forward every error to Sentry (no-op if not initialized).
        // Lazy import keeps logger usable in early-bootstrap code paths.
        void import('@/platform/observability/sentry').then(({ captureException, captureMessage }) => {
            if (error) {
                captureException(error, { ...context, message });
            } else {
                captureMessage(message, 'error', context);
            }
        });
    },
};

/**
 * Generate a correlation ID for request tracing
 */
export function generateCorrelationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a scoped logger for a specific module
 */
export function createModuleLogger(module: string) {
    type ModuleContext = Omit<LogContext, 'module'> & { operation: string };
    return {
        debug: (message: string, context: ModuleContext) =>
            logger.debug(message, { ...context, module }),
        info: (message: string, context: ModuleContext) =>
            logger.info(message, { ...context, module }),
        warn: (message: string, context: ModuleContext, error?: Error) =>
            logger.warn(message, { ...context, module }, error),
        error: (message: string, context: ModuleContext, error?: Error) =>
            logger.error(message, { ...context, module }, error),
    };
}

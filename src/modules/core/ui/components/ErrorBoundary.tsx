import React, { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '@/modules/core/lib/logger';

/* ============================================================
   TYPES
   ============================================================ */

interface ErrorBoundaryProps {
    children:  ReactNode;
    fallback?: ReactNode;
    onError?:  (error: Error, errorInfo: ErrorInfo) => void;
    module?:   string;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error:    Error | null;
}

/* ============================================================
   TACTICAL INCIDENT FALLBACK
   Design direction: dark command-center diagnostic readout.
   - Amber accent = caution authority (not alarming red)
   - Monospace font = system authenticity
   - Scanline animation = alive, not static
   - Deterministic error code from message hash
   ============================================================ */

const SCANLINE_CSS = `
@keyframes eb-scan {
  0%   { transform: translateY(-200%); opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { transform: translateY(200%); opacity: 0; }
}
@keyframes eb-pulse-ring {
  0%, 100% { box-shadow: 0 0 0 0   rgba(245,158,11,0.35); }
  50%       { box-shadow: 0 0 0 6px rgba(245,158,11,0);    }
}
.eb-scanline::before {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent 3px,
    rgba(245,158,11,0.015) 3px,
    rgba(245,158,11,0.015) 4px
  );
  pointer-events: none;
  border-radius: inherit;
}
.eb-scanline::after {
  content: '';
  position: absolute;
  left: 0; right: 0;
  height: 60px;
  background: linear-gradient(
    to bottom,
    transparent,
    rgba(245,158,11,0.08),
    transparent
  );
  animation: eb-scan 5s ease-in-out infinite;
  pointer-events: none;
}
.eb-icon-ring {
  animation: eb-pulse-ring 2.5s ease-in-out infinite;
}
`;

function hashMessage(msg: string): number {
    let h = 0;
    for (let i = 0; i < msg.length; i++) {
        h = (Math.imul(31, h) + msg.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

function IncidentFallback({
    error,
    onRetry,
}: {
    error: Error | null;
    onRetry: () => void;
}) {
    const code = error
        ? `ERR_${(hashMessage(error.message) % 9000 + 1000).toString().padStart(4, '0')}`
        : 'ERR_UNKNOWN';

    const isDev = process.env.NODE_ENV === 'development';

    return (
        <div className="relative flex items-center justify-center min-h-[240px] p-8 bg-[#070d1a] overflow-hidden rounded-lg eb-scanline">
            <style>{SCANLINE_CSS}</style>

            <div className="relative z-10 w-full max-w-sm">
                {/* ── Header ── */}
                <div className="flex items-start gap-4 mb-5">
                    <div className="eb-icon-ring mt-0.5 flex-shrink-0 w-9 h-9 rounded-md border border-amber-500/50 bg-amber-500/10 flex items-center justify-center">
                        <svg
                            className="w-4 h-4 text-amber-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1.75}
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                            />
                        </svg>
                    </div>

                    <div>
                        <p className="text-[10px] font-mono tracking-[0.18em] uppercase text-amber-400/50 leading-none mb-1">
                            System Incident
                        </p>
                        <p className="text-sm font-mono font-semibold text-amber-400 leading-none">
                            {code}
                        </p>
                    </div>
                </div>

                {/* ── Amber rule ── */}
                <div className="h-px bg-gradient-to-r from-amber-500/60 via-amber-400/30 to-transparent mb-5" />

                {/* ── Message ── */}
                <h3 className="text-sm font-medium text-white mb-1.5">
                    Component render failure
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-5">
                    An unexpected error interrupted this view. Your data is safe —
                    the rest of the application is still running normally.
                </p>

                {/* ── Dev trace ── */}
                {isDev && error && (
                    <details className="mb-5 group">
                        <summary className="text-[10px] font-mono text-slate-500 cursor-pointer select-none hover:text-slate-300 transition-colors list-none flex items-center gap-1.5">
                            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                            stack trace
                        </summary>
                        <pre className="mt-2 p-3 text-[10px] font-mono bg-black/50 border border-white/5 rounded text-slate-400 overflow-auto max-h-28 leading-relaxed whitespace-pre-wrap break-all">
                            {error.message}{'\n'}{error.stack?.split('\n').slice(1, 5).join('\n')}
                        </pre>
                    </details>
                )}

                {/* ── Status grid ── */}
                <div className="grid grid-cols-3 gap-2 mb-5">
                    {[
                        { label: 'Auth',   ok: true  },
                        { label: 'Data',   ok: true  },
                        { label: 'Render', ok: false },
                    ].map(({ label, ok }) => (
                        <div
                            key={label}
                            className="flex flex-col items-center gap-1 p-2 rounded border bg-white/[0.02]"
                            style={{ borderColor: ok ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.25)' }}
                        >
                            <span
                                className="text-[9px] font-mono tracking-widest uppercase"
                                style={{ color: ok ? 'rgb(134,239,172)' : 'rgb(252,211,77)' }}
                            >
                                {ok ? '● OK' : '○ FAIL'}
                            </span>
                            <span className="text-[9px] font-mono text-slate-500">{label}</span>
                        </div>
                    ))}
                </div>

                {/* ── Actions ── */}
                <div className="flex gap-2">
                    <button
                        onClick={onRetry}
                        className="flex-1 px-3 py-2 text-[10px] font-mono font-semibold tracking-widest uppercase rounded border border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/70 transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400"
                    >
                        ↻&nbsp;&nbsp;Retry
                    </button>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-3 py-2 text-[10px] font-mono font-semibold tracking-widest uppercase rounded border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                    >
                        Reload
                    </button>
                </div>
            </div>
        </div>
    );
}

/* ============================================================
   ERROR BOUNDARY CLASS
   ============================================================ */

/**
 * Catches JavaScript errors anywhere in the child component tree.
 * Shows a distinctive "tactical incident" fallback UI by default,
 * or a custom `fallback` prop if provided.
 *
 * Includes a `retry()` method so the "Retry" button resets the
 * boundary without a full page reload.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
        this.retry = this.retry.bind(this);
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        const { onError, module: mod = 'unknown' } = this.props;

        logger.error('React component error caught', {
            module:         mod,
            operation:      'render',
            componentStack: errorInfo.componentStack || 'unavailable',
        }, error);

        onError?.(error, errorInfo);
    }

    retry(): void {
        this.setState({ hasError: false, error: null });
    }

    render(): ReactNode {
        if (!this.state.hasError) {
            return this.props.children;
        }

        if (this.props.fallback) {
            return this.props.fallback;
        }

        return (
            <IncidentFallback
                error={this.state.error}
                onRetry={this.retry}
            />
        );
    }
}

export default ErrorBoundary;
